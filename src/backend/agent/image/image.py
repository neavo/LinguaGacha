"""图片第一阶段像素处理运行时：规范化、局部重检与分组建议、解耦掩码/背景检测与无痕擦除、验收打包。

所有推理经标准输入输出二进制通道交由宿主页 Worker 执行，本进程不加载模型会话。
"""

import hashlib
import importlib.util
import json
import math
import sys
import threading
import traceback
import zipfile
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(1)

def _load_sibling(name, dev_dir):
    candidate = Path(__file__).with_name(name)
    if not candidate.exists():
        candidate = Path(__file__).parent.parent / dev_dir / name
    spec = importlib.util.spec_from_file_location(f"image_{candidate.stem.replace('-', '_')}", candidate)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_channel_mod = _load_sibling("channel.py", "inference")
Channel = _channel_mod.Channel
_det_mod = _load_sibling("text-detection.py", "inference")
DET_SIDE = _det_mod.DET_SIDE
det_input = _det_mod.det_input
det_boxes = _det_mod.det_boxes

IMAGE_SIZE = 1280
CONF, IOU, MAX_DET = 0.1, 0.7, 300
BUBBLE_SCORE_MIN, TEXT_SCORE_MIN = 0.25, 0.35
BUBBLE_DUP_IOU, BUBBLE_NEST_OVERLAP = 0.5, 0.95
LINE_CONTAINER_OVERLAP, LINE_DIR_RATIO = 0.8, 1.4
REDETECT_SIDE, REDETECT_EXPAND = 320, 0.15
FILL_SPREAD_MAX, FILL_SHIFT_MAX, MIN_RING_SAMPLES = 14, 12, 24
READING_ROW_RATIO = 0.04
INPAINT_EDGE, CONTEXT_RATIO, CONTEXT_MIN, MODEL_STRIDE = 2048, 0.35, 64, 64


# ---------------------------------------------------------------- 基础图像与张量通道


def read_image(path):
    """按 EXIF 方向读取三通道非透明图并检查像素上限。"""
    encoded = np.fromfile(str(path), dtype=np.uint8)
    raw = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise ValueError(f"Unsupported or unreadable image: {path}")
    if raw.dtype not in (np.uint8, np.uint16):
        raise ValueError("Unsupported image bit depth")
    if raw.ndim == 3 and raw.shape[2] == 4 and np.any(raw[:, :, 3] != 255):
        raise ValueError("Transparent input is unsupported")
    del raw
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None or image.shape[0] <= 0 or image.shape[1] <= 0:
        raise ValueError(f"Cannot decode BGR image: {path}")
    if image.shape[0] * image.shape[1] > 100_000_000:
        raise ValueError("Image pixel budget exceeded")
    return image


def save(file, image):
    """PNG 编码成功后写出磁盘并返回解析路径。"""
    Path(file).parent.mkdir(parents=True, exist_ok=True)
    ok, data = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("PNG encoding failed")
    data.tofile(str(file))
    return str(Path(file).resolve())


def file_sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def forward(channel, kind, data):
    """请求 YOLO / LaMa 类带 `shapes` 头的模型输出并恢复张量。"""
    header, payload = channel.request(kind, data).result()
    values = np.frombuffer(payload, np.float32)
    results, offset = [], 0
    for shape in header["shapes"]:
        count = math.prod(shape)
        results.append(values[offset : offset + count].reshape(shape))
        offset += count
    if offset != len(values) or not np.isfinite(values).all():
        raise ValueError("Invalid image model response")
    return results


def request_det(channel, frame, upscale=False):
    """调用共享 PP-OCR det 并返回原图或裁图尺度下的概率图。"""
    tensor = det_input(frame, side=REDETECT_SIDE if upscale else DET_SIDE, upscale=upscale)
    header, payload = channel.request("det", tensor).result()
    values = np.frombuffer(payload, np.float32)
    shape = header["shape"]
    if len(shape) != 2 or math.prod(shape) != len(values) or not np.isfinite(values).all():
        raise ValueError("Invalid det response")
    return values.reshape(shape)


def normalize(args, _channel):
    """无模型规范化：按 EXIF 方向解码后写出标准 PNG 与核对尺寸。"""
    pages = []
    for entry in args["pages"]:
        image = read_image(entry["source"])
        h, w = image.shape[:2]
        out = save(entry["target"], image)
        pages.append(dict(pageId=entry["pageId"], path=out, width=w, height=h))
    return dict(pages=pages)


# ---------------------------------------------------------------- 几何与候选检测


def quad_to_pts(quad):
    return np.array([[float(p["x"]), float(p["y"])] for p in quad], np.float32)


def pts_to_quad(pts, w, h):
    return [
        {"x": round(float(np.clip(p[0], 0.0, w)), 2), "y": round(float(np.clip(p[1], 0.0, h)), 2)}
        for p in pts
    ]


def rect_to_pts(x0, y0, x1, y1):
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float32)


def poly_area(pts):
    return float(abs(cv2.contourArea(pts.astype(np.float32))))


def poly_inter_area(pts_a, pts_b):
    area, _ = cv2.intersectConvexConvex(pts_a.astype(np.float32), pts_b.astype(np.float32))
    return float(max(0.0, area))


def poly_iou(pts_a, pts_b):
    inter = poly_inter_area(pts_a, pts_b)
    if inter <= 0:
        return 0.0
    union = poly_area(pts_a) + poly_area(pts_b) - inter
    return inter / max(union, 1e-6)


def postprocess(raw, proto, shape, input_shape):
    """在模型边界恢复原图坐标，框和掩码使用同一缩放与补边。"""
    pred = raw[0].T
    labels = pred[:, 4:7].argmax(1)
    scores = pred[np.arange(len(pred)), labels + 4]
    candidates = np.flatnonzero(scores > CONF)
    candidates = candidates[np.argsort(-scores[candidates], kind="stable")][:30000]
    boxes = np.concatenate((pred[:, :2] - pred[:, 2:4] / 2, pred[:, :2] + pred[:, 2:4] / 2), 1)
    kept = []
    while len(candidates) and len(kept) < MAX_DET:
        i, candidates = candidates[0], candidates[1:]
        kept.append(i)
        inter = np.maximum(
            0,
            np.minimum(boxes[i, 2:], boxes[candidates, 2:])
            - np.maximum(boxes[i, :2], boxes[candidates, :2]),
        ).prod(1)
        area = (boxes[:, 2:] - boxes[:, :2]).prod(1)
        overlap = inter / (area[i] + area[candidates] - inter + 1e-7)
        candidates = candidates[(overlap <= IOU) | (labels[candidates] != labels[i])]
    h, w = shape
    ih, iw = input_shape
    gain = min(ih / h, iw / w)
    pad = np.array(
        [round((iw - round(w * gain)) / 2 - 0.1), round((ih - round(h * gain)) / 2 - 0.1)] * 2
    )
    gains = np.array([max(round(w * gain), 1) / w, max(round(h * gain), 1) / h] * 2)
    scaled = (boxes[kept] - pad) / gains
    scaled[:, [0, 2]] = scaled[:, [0, 2]].clip(0, w)
    scaled[:, [1, 3]] = scaled[:, [1, 3]].clip(0, h)
    _, mh, mw = proto[0].shape
    mask_gain = min(4 * mh / h, 4 * mw / w)
    padding = (4 * mh - max(round(h * mask_gain), 1)) | (4 * mw - max(round(w * mask_gain), 1))
    factor = 4 // math.gcd(4, padding | padding // 2)
    masks, records = [], []
    for i, box in zip(kept, scaled):
        logits = (pred[i, 7:] @ proto[0].reshape(32, -1)).reshape(mh, mw)
        if factor > 1:
            logits = cv2.resize(logits, (mw * factor, mh * factor), interpolation=cv2.INTER_LINEAR)
        sh, sw = logits.shape
        mg = min(sh / h, sw / w)
        ch, cw = max(round(h * mg), 1), max(round(w * mg), 1)
        top, left = round((sh - ch) / 2 - 0.1), round((sw - cw) / 2 - 0.1)
        mask = (
            cv2.resize(logits[top : top + ch, left : left + cw], (w, h), interpolation=cv2.INTER_LINEAR)
            > 0
        )
        yy, xx = np.ogrid[:h, :w]
        mask &= (xx >= box[0]) & (xx < box[2]) & (yy >= box[1]) & (yy < box[3])
        if mask.any():
            masks.append(mask)
            records.append([*box, float(scores[i]), int(labels[i])])
    return np.array(records), masks


def _dedup_bubbles(boxes, pp_lines):
    """拥有相同非空 PP 成员集合且 IoU > 0.5 的重复气泡保留高分者，并记录合并关系。"""
    annotated = []
    for box in boxes:
        members = tuple(
            l_idx
            for l_idx, line in enumerate(pp_lines)
            if poly_inter_area(line, box["pts"]) / max(1e-6, poly_area(line)) >= LINE_CONTAINER_OVERLAP
        )
        annotated.append((box, members))
    annotated.sort(key=lambda item: (-item[0]["score"], item[0]["area"]))
    kept = []
    for box, members in annotated:
        merged_into = None
        if members:
            for prev_box, prev_members in kept:
                if members == prev_members:
                    iou = poly_iou(box["pts"], prev_box["pts"])
                    if iou > BUBBLE_DUP_IOU:
                        merged_into = (prev_box, iou)
                        break
        if merged_into is not None:
            target, iou = merged_into
            target.setdefault("merged", []).append(dict(score=round(float(box["score"]), 4), iou=round(float(iou), 4)))
            continue
        kept.append((dict(box), members))
    return [box for box, _ in kept]


def _merge_crop_rects(rects, w, h):
    """合并彼此重叠或相邻的补检裁剪窗，减少重复调用共享 `det`。"""
    merged = list(rects)
    changed = True
    while changed:
        changed = False
        next_rects = []
        while merged:
            x0, y0, x1, y1 = merged.pop(0)
            i = 0
            while i < len(merged):
                ax0, ay0, ax1, ay1 = merged[i]
                if max(x0, ax0) <= min(x1, ax1) + 8 and max(y0, ay0) <= min(y1, ay1) + 8:
                    x0, y0 = min(x0, ax0), min(y0, ay0)
                    x1, y1 = max(x1, ax1), max(y1, ay1)
                    merged.pop(i)
                    changed = True
                else:
                    i += 1
            next_rects.append((max(0, x0), max(0, y0), min(w, x1), min(h, y1)))
        merged = next_rects
    return merged


def _redetect_missing_lines(image, channel, containers, lines):
    """对缺少 PP-OCR 文字行支撑的 YOLO 候选，合并局部窗口后放大到 320 再测一次 `det`。"""
    h, w = image.shape[:2]
    crop_rects = []
    for c in containers:
        c_pts = c["pts"]
        supported = any(
            poly_inter_area(line, c_pts) / max(1e-6, poly_area(line)) >= 0.3 for line in lines
        )
        if supported:
            continue
        x0, y0 = c_pts[:, 0].min(), c_pts[:, 1].min()
        x1, y1 = c_pts[:, 0].max(), c_pts[:, 1].max()
        mx = max(8.0, (x1 - x0) * REDETECT_EXPAND)
        my = max(8.0, (y1 - y0) * REDETECT_EXPAND)
        crop_rects.append((math.floor(x0 - mx), math.floor(y0 - my), math.ceil(x1 + mx), math.ceil(y1 + my)))
    merged = _merge_crop_rects(crop_rects, w, h)
    added = list(lines)
    for x0, y0, x1, y1 in merged:
        if x1 - x0 < 8 or y1 - y0 < 8:
            continue
        sub = image[y0:y1, x0:x1]
        pred = request_det(channel, sub, upscale=True)
        local_boxes = det_boxes(pred, y1 - y0, x1 - x0, round_coords=False)
        for box in local_boxes:
            global_box = box.copy()
            global_box[:, 0] += x0
            global_box[:, 1] += y0
            g_area = max(1e-6, poly_area(global_box))
            if not any(
                poly_iou(global_box, prev) > 0.5 or poly_inter_area(global_box, prev) / g_area > 0.7
                for prev in added
            ):
                added.append(global_box)
    return added


def _group_unowned_lines(unowned):
    """无气泡容器的自由文字行按主方向与近邻几何聚合成语义组。"""
    n = len(unowned)
    if n == 0:
        return []
    bounds = [
        (float(p[:, 0].min()), float(p[:, 1].min()), float(p[:, 0].max()), float(p[:, 1].max()))
        for p in unowned
    ]
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        ax0, ay0, ax1, ay1 = bounds[i]
        aw, ah = ax1 - ax0, ay1 - ay0
        a_vert = ah > aw * 1.1
        for j in range(i + 1, n):
            bx0, by0, bx1, by1 = bounds[j]
            bw, bh = bx1 - bx0, by1 - by0
            b_vert = bh > bw * 1.1
            if a_vert != b_vert:
                continue
            gx = max(0.0, max(ax0, bx0) - min(ax1, bx1))
            gy = max(0.0, max(ay0, by0) - min(ay1, by1))
            ox = max(0.0, min(ax1, bx1) - max(ax0, bx0))
            oy = max(0.0, min(ay1, by1) - max(ay0, by0))
            if a_vert:
                min_w = max(4.0, min(aw, bw))
                if gx <= min_w * 1.2 and oy / max(1e-6, min(ah, bh)) >= 0.4:
                    union(i, j)
            else:
                min_h = max(4.0, min(ah, bh))
                if gy <= min_h * 1.2 and ox / max(1e-6, min(aw, bw)) >= 0.4:
                    union(i, j)
    groups = {}
    for i, pts in enumerate(unowned):
        groups.setdefault(find(i), []).append(pts)
    return list(groups.values())


def _group_candidates(bubbles, yolo_texts, pp_lines):
    """容器优先聚合：同非空成员重复气泡先合并，再按高置信嵌套选最紧内层或无容器几何聚类。"""
    deduped_bubbles = _dedup_bubbles(bubbles, pp_lines)
    ordered_bubbles = sorted(deduped_bubbles, key=lambda b: b["area"])
    bubble_lines = [[] for _ in ordered_bubbles]
    text_containers = [
        t
        for t in yolo_texts
        if not any(
            poly_inter_area(t["pts"], b["pts"]) / max(1e-6, t["area"]) > 0.7 for b in ordered_bubbles
        )
    ]
    yolo_text_lines = [[] for _ in text_containers]
    unowned, ambiguous_indices = [], set()

    for line in pp_lines:
        l_area = max(1e-6, poly_area(line))
        matched_bubbles = [
            idx
            for idx, b in enumerate(ordered_bubbles)
            if poly_inter_area(line, b["pts"]) / l_area >= LINE_CONTAINER_OVERLAP
        ]
        if matched_bubbles:
            # 若最内层已被外层显著嵌套(>0.95)或明显更小，归入最内层；否则记歧义供人/Agent核查。
            target = matched_bubbles[0]
            for other in matched_bubbles[1:]:
                inner, outer = ordered_bubbles[target], ordered_bubbles[other]
                if poly_inter_area(inner["pts"], outer["pts"]) / max(1e-6, inner["area"]) <= BUBBLE_NEST_OVERLAP:
                    ambiguous_indices.add(target)
                    ambiguous_indices.add(other)
            bubble_lines[target].append(line)
            continue

        matched_texts = [
            idx
            for idx, t in enumerate(text_containers)
            if poly_inter_area(line, t["pts"]) / l_area >= LINE_CONTAINER_OVERLAP
        ]
        if matched_texts:
            yolo_text_lines[matched_texts[0]].append(line)
        else:
            unowned.append(line)

    candidates = []
    for idx, b in enumerate(ordered_bubbles):
        lines = bubble_lines[idx]
        uncertain = len(lines) == 0 or idx in ambiguous_indices or b["score"] < 0.45
        areas = lines if lines else [b["pts"]]
        candidates.append(
            dict(
                kind="bubble",
                textAreas=areas,
                containerPts=b["pts"],
                score=b["score"],
                source="bubble+det" if lines else "yolo_only",
                uncertain=uncertain,
                **({"merged": b["merged"]} if b.get("merged") else {}),
            )
        )
    for idx, t in enumerate(text_containers):
        lines = yolo_text_lines[idx]
        areas = lines if lines else [t["pts"]]
        candidates.append(
            dict(
                kind="text",
                textAreas=areas,
                containerPts=t["pts"],
                score=t["score"],
                source="yolo_text+det" if lines else "yolo_only",
                uncertain=len(lines) == 0 or t["score"] < 0.5,
            )
        )
    for group in _group_unowned_lines(unowned):
        all_pts = np.concatenate(group, axis=0)
        x0, y0 = float(all_pts[:, 0].min()), float(all_pts[:, 1].min())
        x1, y1 = float(all_pts[:, 0].max()), float(all_pts[:, 1].max())
        candidates.append(
            dict(
                kind="text",
                textAreas=group,
                containerPts=rect_to_pts(x0, y0, x1, y1),
                score=0.5,
                source="det_group",
                uncertain=False,
            )
        )
    return candidates


def _suggest_direction(item):
    """仅依据 PP 文字行形状给出方向建议；无 PP 行、近方形短字或混合方向返回 None。"""
    if item["source"] == "yolo_only":
        return None
    directions = set()
    for pts in item["textAreas"]:
        lw = float(pts[:, 0].max() - pts[:, 0].min())
        lh = float(pts[:, 1].max() - pts[:, 1].min())
        if lh > lw * LINE_DIR_RATIO:
            directions.add("vertical-rl")
        elif lw > lh * LINE_DIR_RATIO:
            directions.add("horizontal-tb")
        else:
            return None
    return next(iter(directions)) if len(directions) == 1 else None


def prepare(args, channel):
    """第一阶段取证：共享 `manga` + `det` 局部重检、容器分组与预览/裁图证据。"""
    image = read_image(args["source"])
    h, w = image.shape[:2]
    root = Path(args["output"])
    root.mkdir(parents=True, exist_ok=True)

    gain = IMAGE_SIZE / max(h, w)
    nh, nw = round(h * gain), round(w * gain)
    resized = cv2.resize(image, (nw, nh))
    ih, iw = math.ceil(nh / 32) * 32, math.ceil(nw / 32) * 32
    top, left = round((ih - nh) / 2 - 0.1), round((iw - nw) / 2 - 0.1)
    padded = cv2.copyMakeBorder(
        resized, top, ih - nh - top, left, iw - nw - left, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    raw, proto = forward(channel, "manga", padded[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255)
    boxes, _ = postprocess(raw, proto, (h, w), (ih, iw))

    raw_bubbles, raw_texts = [], []
    for box in boxes:
        x0, y0, x1, y1, score, label = box
        pts = rect_to_pts(float(x0), float(y0), float(x1), float(y1))
        entry = dict(pts=pts, area=max(1.0, poly_area(pts)), score=float(score))
        if int(label) == 2 and float(score) >= BUBBLE_SCORE_MIN:
            raw_bubbles.append(entry)
        elif int(label) == 1 and float(score) >= TEXT_SCORE_MIN:
            raw_texts.append(entry)

    full_pred = request_det(channel, image, upscale=False)
    pp_lines = det_boxes(full_pred, h, w, round_coords=False)
    pp_lines = _redetect_missing_lines(image, channel, raw_bubbles + raw_texts, pp_lines)
    grouped = _group_candidates(raw_bubbles, raw_texts, pp_lines)

    vertical = sum(
        (c["containerPts"][:, 1].max() - c["containerPts"][:, 1].min())
        > (c["containerPts"][:, 0].max() - c["containerPts"][:, 0].min())
        for c in grouped
    ) > len(grouped) / 2
    grouped.sort(
        key=lambda c: (
            round(float(c["containerPts"][:, 1].min()) / max(1.0, h * READING_ROW_RATIO)),
            -float(c["containerPts"][:, 0].min()) if vertical else float(c["containerPts"][:, 0].min()),
        )
    )

    preview = image.copy()
    thickness = max(1, round(max(h, w) / 900))
    font_scale = max(0.55, max(h, w) / 1600)
    candidates, draft_regions, crop_paths = [], [], {}

    for idx, item in enumerate(grouped, 1):
        rid = f"r{idx}"
        text_quads = [pts_to_quad(pts, w, h) for pts in item["textAreas"]]
        c_pts = item["containerPts"]
        cx0 = max(0, math.floor(float(c_pts[:, 0].min())))
        cy0 = max(0, math.floor(float(c_pts[:, 1].min())))
        cx1 = min(w, math.ceil(float(c_pts[:, 0].max())))
        cy1 = min(h, math.ceil(float(c_pts[:, 1].max())))
        guess_dir = _suggest_direction(item)

        draft_regions.append(
            dict(
                regionId=rid,
                kind=item["kind"],
                disposition="translate",
                textAreas=text_quads,
                direction=guess_dir,
                erase=dict(method="auto", mask="strokes", exclusions=[]),
            )
        )
        candidates.append(
            dict(
                regionId=rid,
                kind=item["kind"],
                score=round(float(item["score"]), 4),
                source=item["source"],
                uncertain=bool(item["uncertain"]),
                textAreas=text_quads,
                **({"merged": item["merged"]} if item.get("merged") else {}),
            )
        )
        color = (0, 140, 255) if item["uncertain"] else (0, 0, 220)
        for pts in item["textAreas"]:
            cv2.polylines(preview, [np.round(pts).astype(np.int32)], True, color, thickness)
        cv2.putText(preview, rid, (cx0, max(24, cy0)), 0, font_scale, color, 2)

        # 每个候选切出一份带清晰边距的局部证据图，方便按需直视核对细节。
        pad_px = max(12, round(max(cx1 - cx0, cy1 - cy0) * 0.15))
        sx0, sy0 = max(0, cx0 - pad_px), max(0, cy0 - pad_px)
        sx1, sy1 = min(w, cx1 + pad_px), min(h, cy1 + pad_px)
        crop = image[sy0:sy1, sx0:sx1].copy()
        for pts in item["textAreas"]:
            shifted = np.round(pts - np.array([sx0, sy0], np.float32)).astype(np.int32)
            cv2.polylines(crop, [shifted], True, color, 2)
        if min(crop.shape[:2]) < 160 and max(crop.shape[:2]) > 0:
            up = min(3.0, 200.0 / max(crop.shape[:2]))
            if up > 1.0:
                crop = cv2.resize(crop, (round(crop.shape[1] * up), round(crop.shape[0] * up)), interpolation=cv2.INTER_CUBIC)
        crop_paths[rid] = save(root / "crops" / f"{rid}.png", crop)

    scale = min(1.0, 1600 / max(h, w))
    preview_path = save(root / "preview.png", cv2.resize(preview, (round(w * scale), round(h * scale))))
    evidence = dict(
        width=w,
        height=h,
        preview=preview_path,
        previewScale=scale,
        crops=crop_paths,
        candidates=candidates,
        draftRegions=draft_regions,
    )
    (root / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False), "utf-8")
    return evidence


# ---------------------------------------------------------------- 解耦掩码、背景检查与页面级擦除


def _rasterize_quads(shape_hw, quads):
    mask = np.zeros(shape_hw, dtype=np.uint8)
    for quad in quads:
        pts = np.round(quad_to_pts(quad)).astype(np.int32)
        cv2.fillConvexPoly(mask, pts, 255)
    return mask


def build_mask(image, region):
    """独立掩码构建：按区域与擦除配置生成逐区域掩码并报告缺口。"""
    h, w = image.shape[:2]
    if region["disposition"] == "preserve":
        return np.zeros((h, w), dtype=np.uint8), None

    erase_opts = region.get("erase") or {}
    mask_mode = erase_opts.get("mask", "strokes")
    explicit_pad = erase_opts.get("padding")
    exclusions = erase_opts.get("exclusions") or []
    quad_pts = [quad_to_pts(q) for q in region["textAreas"]]

    # 未显式给 padding 时按字体行短边动态取 2..8px。
    minor_sides = [
        min(float(np.linalg.norm(pts[1] - pts[0])), float(np.linalg.norm(pts[3] - pts[0])))
        for pts in quad_pts
    ]
    scale_ref = float(np.median(minor_sides)) if minor_sides else 16.0
    pad_px = max(2, min(8, round(scale_ref * 0.08))) if explicit_pad is None else round(float(explicit_pad))

    excl_mask = _rasterize_quads((h, w), exclusions) if exclusions else None
    mask = np.zeros((h, w), dtype=np.uint8)
    incomplete = False

    if mask_mode == "areas":
        mask = _rasterize_quads((h, w), region["textAreas"])
        if pad_px > 0:
            k = pad_px * 2 + 1
            mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)), iterations=1)
    else:
        for pts in quad_pts:
            x0 = max(0, math.floor(float(pts[:, 0].min())) - pad_px - 6)
            y0 = max(0, math.floor(float(pts[:, 1].min())) - pad_px - 6)
            x1 = min(w, math.ceil(float(pts[:, 0].max())) + pad_px + 6)
            y1 = min(h, math.ceil(float(pts[:, 1].max())) + pad_px + 6)
            if x1 - x0 < 3 or y1 - y0 < 3:
                incomplete = True
                continue
            cw, ch = x1 - x0, y1 - y0
            crop_bgr = image[y0:y1, x0:x1]
            gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

            local_poly = np.round(pts - np.array([x0, y0], np.float32)).astype(np.int32)
            inner_area = np.zeros((ch, cw), dtype=np.uint8)
            cv2.fillConvexPoly(inner_area, local_poly, 255)
            allow_k = max(1, pad_px) * 2 + 1
            allow_area = cv2.dilate(
                inner_area, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (allow_k, allow_k)), iterations=1
            )
            ring = (allow_area > 0) & (inner_area == 0)

            # 比较两种二值极性与周围环带亮度，自动兼容黑字白底与白字黑底。
            white_vals = gray[(binary == 255) & (inner_area > 0)]
            dark_vals = gray[(binary == 0) & (inner_area > 0)]
            ring_vals = gray[ring]
            if len(ring_vals) >= 4 and len(white_vals) > 0 and len(dark_vals) > 0:
                ring_med = float(np.median(ring_vals))
                fg_is_dark = abs(float(np.mean(white_vals)) - ring_med) <= abs(
                    float(np.mean(dark_vals)) - ring_med
                )
            else:
                fg_is_dark = np.mean(binary[inner_area > 0] == 255) >= 0.5
            fg = (255 - binary) if fg_is_dark else binary

            # 仅去掉跨过整条裁剪边的框线干扰，保留文字笔画主体。
            n_comp, labels, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
            cleaned = np.zeros_like(fg)
            for idx in range(1, n_comp):
                cx, cy, sw, sh, area = stats[idx]
                if area < 2:
                    continue
                touches_edge = cx == 0 or cy == 0 or cx + sw >= cw or cy + sh >= ch
                if touches_edge and (sw >= cw * 0.9 or sh >= ch * 0.9):
                    continue
                cleaned[labels == idx] = 255

            cleaned &= allow_area
            if excl_mask is not None:
                cleaned &= 255 - excl_mask[y0:y1, x0:x1]
            stroke_pad = max(1, round(pad_px * 0.6)) if pad_px > 0 else 0
            if np.any(cleaned) and stroke_pad > 0:
                sk = stroke_pad * 2 + 1
                cleaned = cv2.dilate(
                    cleaned, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (sk, sk)), iterations=1
                )
                cleaned &= allow_area

            inside_check = cleaned & inner_area
            area_px = int(np.sum(inner_area > 0))
            if area_px >= 64 and not np.any(inside_check):
                # 若整块全被 exclusions 覆盖则不算缺失。
                unexcluded = int(np.sum((inner_area > 0) & ((excl_mask[y0:y1, x0:x1] == 0) if excl_mask is not None else True)))
                if unexcluded >= 64:
                    incomplete = True
            mask[y0:y1, x0:x1] |= cleaned

    if excl_mask is not None:
        mask[excl_mask > 0] = 0

    if not np.any(mask):
        return mask, "empty_mask"
    if incomplete:
        return mask, "incomplete_strokes"
    return mask, None


def check_background(image, mask, all_masks=None):
    """检查掩码周界局部环带的各子象限分散度与跨象限偏移，取最严处判断是否可纯色直填。"""
    if not np.any(mask):
        return False, np.array([255, 255, 255], np.uint8)
    h, w = image.shape[:2]
    x, y, bw, bh = cv2.boundingRect(mask)
    ring_w = max(8, min(28, round(max(bw, bh) * 0.12)))
    rx0, ry0 = max(0, x - ring_w), max(0, y - ring_w)
    rx1, ry1 = min(w, x + bw + ring_w), min(h, y + bh + ring_w)

    roi_mask = mask[ry0:ry1, rx0:rx1]
    k_outer = ring_w * 2 + 1
    outer = cv2.dilate(roi_mask, np.ones((k_outer, k_outer), np.uint8), iterations=1) > 0
    inner = cv2.dilate(roi_mask, np.ones((5, 5), np.uint8), iterations=1) > 0
    ring = outer & ~inner
    if all_masks is not None:
        ring &= all_masks[ry0:ry1, rx0:rx1] == 0

    ring_pixels = image[ry0:ry1, rx0:rx1][ring]
    if len(ring_pixels) < MIN_RING_SAMPLES:
        return False, np.median(ring_pixels, axis=0).round().astype(np.uint8) if len(ring_pixels) else np.array([255, 255, 255], np.uint8)

    # 划分 2x2 象限检查局部平坦度与跨侧色偏，避免单一均值掩盖渐变或网点。
    ys, xs = np.nonzero(roi_mask)
    cy, cx = float(np.mean(ys)), float(np.mean(xs))
    ry, rx = np.nonzero(ring)
    roi_img = image[ry0:ry1, rx0:rx1]
    quad_spreads, quad_medians = [], []
    for cond in ((ry < cy) & (rx < cx), (ry < cy) & (rx >= cx), (ry >= cy) & (rx < cx), (ry >= cy) & (rx >= cx)):
        pts_px = roi_img[ry[cond], rx[cond]]
        if len(pts_px) < 6:
            continue
        iqr = np.percentile(pts_px, 75, axis=0) - np.percentile(pts_px, 25, axis=0)
        quad_spreads.append(float(np.max(iqr)))
        quad_medians.append(np.median(pts_px, axis=0))

    bg = np.median(ring_pixels, axis=0).round().astype(np.uint8)
    if len(quad_medians) < 2:
        return False, bg
    worst_spread = max(quad_spreads)
    inter_shift = max(
        float(np.max(np.abs(quad_medians[i] - quad_medians[j])))
        for i in range(len(quad_medians))
        for j in range(i + 1, len(quad_medians))
    )
    return (worst_spread <= FILL_SPREAD_MAX and inter_shift <= FILL_SHIFT_MAX), bg


def _draw_overlay(image, page_regions, masks, conflict):
    overlay = image.copy()
    for region in page_regions:
        rid = region["regionId"]
        if region["disposition"] == "preserve":
            for quad in region["textAreas"]:
                pts = np.round(quad_to_pts(quad)).astype(np.int32)
                cv2.polylines(overlay, [pts], True, (220, 120, 40), 2)
            continue
        m = masks[rid] > 0
        tint = np.array([60, 60, 230], np.float32)
        overlay[m] = np.clip(overlay[m].astype(np.float32) * 0.45 + tint * 0.55, 0, 255).astype(np.uint8)
    if np.any(conflict):
        overlay[conflict] = np.array([0, 230, 255], dtype=np.uint8)
    for region in page_regions:
        pts = quad_to_pts(region["textAreas"][0])
        tx, ty = max(0, round(float(pts[:, 0].min()))), max(24, round(float(pts[:, 1].min())))
        cv2.putText(overlay, region["regionId"], (tx, ty), 0, 0.65, (0, 0, 240), 2)
    h, w = overlay.shape[:2]
    scale = min(1.0, 1600 / max(h, w))
    return cv2.resize(overlay, (round(w * scale), round(h * scale)))


def erase(args, channel):
    """整页级掩码验收与消字：严查交叠，按策略纯色直填或 LaMa 修复并严格保真掩码外原像素。"""
    page = args["page"]
    root = Path(args["output"])
    root.mkdir(parents=True, exist_ok=True)
    image = read_image(args["source"])
    h, w = image.shape[:2]
    if (w, h) != (page["width"], page["height"]):
        raise ValueError("Page dimensions differ from original")

    masks, mask_gaps = {}, {}
    occupied = np.zeros((h, w), dtype=np.uint8)
    conflict = np.zeros((h, w), dtype=bool)
    translate_regions = [r for r in page["regions"] if r["disposition"] == "translate"]

    for region in translate_regions:
        rid = region["regionId"]
        mask, gap = build_mask(image, region)
        overlap = (occupied > 0) & (mask > 0)
        if np.any(overlap):
            conflict |= overlap
            mask_gaps[rid] = "mask_overlap"
        elif gap:
            mask_gaps[rid] = gap
        occupied |= mask
        masks[rid] = mask

    overlay_path = save(root / "mask-overlay.png", _draw_overlay(image, page["regions"], masks, conflict))

    # 若存在未通过 exclusions 解决的物理交叠，禁止生成半成品 clean.png。
    if np.any(conflict):
        gaps = [dict(regionId=rid, code=code) for rid, code in mask_gaps.items()]
        return dict(
            ok=False,
            clean=None,
            cleanSha256=None,
            overlay=overlay_path,
            gaps=gaps,
            regions=[dict(regionId=r["regionId"], disposition=r["disposition"], gap=mask_gaps.get(r["regionId"])) for r in page["regions"]],
        )

    base = image.copy()
    lama_jobs, methods = [], {}
    for region in translate_regions:
        rid = region["regionId"]
        mask = masks[rid]
        if not np.any(mask):
            methods[rid] = "fill"
            continue
        mode = (region.get("erase") or {}).get("method", "auto")
        if mode == "lama":
            lama_jobs.append(rid)
            methods[rid] = "lama"
        else:
            uniform, bg = check_background(image, mask, all_masks=occupied)
            if uniform:
                base[mask > 0] = bg
                methods[rid] = "fill"
            else:
                lama_jobs.append(rid)
                methods[rid] = "lama"

    if lama_jobs:
        scale = min(1.0, INPAINT_EDGE / max(h, w))
        sh, sw = max(1, round(h * scale)), max(1, round(w * scale))
        lama_union = np.zeros((h, w), dtype=np.uint8)
        for rid in lama_jobs:
            lama_union |= masks[rid]
        snapshot = cv2.resize(base, (sw, sh), interpolation=cv2.INTER_CUBIC)
        scaled_mask = cv2.resize(lama_union, (sw, sh), interpolation=cv2.INTER_AREA) > 0
        scaled_mask = cv2.dilate(scaled_mask.astype(np.uint8), np.ones((3, 3), np.uint8))

        crops = []
        for rid in lama_jobs:
            x, y, bw, bh = cv2.boundingRect(masks[rid])
            margin = max(CONTEXT_MIN, round(max(bw, bh) * CONTEXT_RATIO))
            x0 = max(0, math.floor((x - margin) * sw / w))
            y0 = max(0, math.floor((y - margin) * sh / h))
            x1 = min(sw, math.ceil((x + bw + margin) * sw / w))
            y1 = min(sh, math.ceil((y + bh + margin) * sh / h))
            crops.append((x0, y0, x1, y1, [rid]))
        padded = lambda v: math.ceil(v / MODEL_STRIDE) * MODEL_STRIDE
        if sum(padded(x1 - x0) * padded(y1 - y0) for x0, y0, x1, y1, _ in crops) >= padded(sw) * padded(sh):
            crops = [(0, 0, sw, sh, lama_jobs)]

        for x0, y0, x1, y1, owners in crops:
            crop = snapshot[y0:y1, x0:x1]
            sub_mask = scaled_mask[y0:y1, x0:x1]
            ch, cw = sub_mask.shape
            ph, pw = padded(ch) - ch, padded(cw) - cw
            rgb = cv2.copyMakeBorder(crop, 0, ph, 0, pw, cv2.BORDER_REFLECT)[:, :, ::-1].astype(np.float32) / 255
            m = cv2.copyMakeBorder(sub_mask, 0, ph, 0, pw, cv2.BORDER_CONSTANT).astype(np.float32)
            output = forward(channel, "inpaint", np.concatenate([rgb.transpose(2, 0, 1), m[None]], axis=0)[None])[0]
            restored = output[0].transpose(1, 2, 0)[:ch, :cw, ::-1] * 255
            for rid in owners:
                yy, xx = np.nonzero(masks[rid])
                mapx = ((xx + 0.5) * sw / w - 0.5 - x0).astype(np.float32)
                mapy = ((yy + 0.5) * sh / h - 0.5 - y0).astype(np.float32)
                for start in range(0, len(xx), 16000):
                    stop = start + 16000
                    sampled = cv2.remap(
                        restored, mapx[start:stop].reshape(-1, 1), mapy[start:stop].reshape(-1, 1),
                        cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
                    ).reshape(-1, 3)
                    base[yy[start:stop], xx[start:stop]] = sampled.clip(0, 255).round().astype(np.uint8)

    if not np.array_equal(base[occupied == 0], image[occupied == 0]):
        raise ValueError("Pixels changed outside edit masks")

    clean_path = save(root / "clean.png", base)
    clean_sha = file_sha256(clean_path)
    region_results, gaps = [], []
    for region in page["regions"]:
        rid = region["regionId"]
        if region["disposition"] == "preserve":
            region_results.append(dict(regionId=rid, disposition="preserve", preserveReason=region.get("preserveReason")))
            continue
        m_path = save(root / "masks" / f"{rid}.png", masks[rid])
        gap = mask_gaps.get(rid)
        if gap:
            gaps.append(dict(regionId=rid, code=gap))
        region_results.append(
            dict(
                regionId=rid,
                disposition="translate",
                method=methods[rid],
                mask=m_path,
                maskSha256=file_sha256(m_path),
                gap=gap,
            )
        )

    return dict(
        ok=len(gaps) == 0,
        clean=clean_path,
        cleanSha256=clean_sha,
        overlay=overlay_path,
        gaps=gaps,
        regions=region_results,
    )


# ---------------------------------------------------------------- 流式打包与像素级完整性核验


def pack(args, _channel):
    """写入 `.image` 归档，逐页核对原文/底图/掩码摘要并验证掩码外像素零改动。"""
    root = Path(args["root"])
    sources = {k: Path(v) for k, v in (args.get("sources") or {}).items()}
    normalized = {k: Path(v) for k, v in (args.get("normalized") or {}).items()}
    book = args["book"]
    records = args["records"]
    clean = args["clean"]

    clean_by_id = {p["pageId"]: p for p in clean["pages"]}
    with zipfile.ZipFile(args["output"], "x", allowZip64=False) as archive:
        archive.writestr("image.json", json.dumps(book, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("items.json", json.dumps(records, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("clean.json", json.dumps(clean, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)

        for page in book["pages"]:
            orig_member = page["original"]
            orig_file = sources.get(orig_member, root / orig_member)
            if file_sha256(orig_file) != page["sha256"]:
                raise ValueError(f"Original digest changed: {orig_member}")
            archive.write(orig_file, orig_member, compress_type=zipfile.ZIP_STORED)

            clean_page = clean_by_id.get(page["pageId"])
            if not clean_page:
                raise ValueError(f"Missing clean page: {page['pageId']}")
            clean_member = clean_page["clean"]
            clean_file = sources.get(clean_member, root / clean_member)
            if file_sha256(clean_file) != clean_page["cleanSha256"]:
                raise ValueError(f"Clean digest changed: {clean_member}")
            archive.write(clean_file, clean_member, compress_type=zipfile.ZIP_STORED)

            norm_file = normalized.get(page["pageId"])
            if not norm_file and orig_file.suffix.lower() != ".png":
                raise ValueError(f"Normalized PNG required for non-PNG pack input: {orig_member}")
            orig_img = read_image(norm_file if norm_file else orig_file)
            clean_img = read_image(clean_file)
            if orig_img.shape != clean_img.shape:
                raise ValueError(f"Clean image dimensions differ from original: {clean_member}")
            union = np.zeros(orig_img.shape[:2], dtype=np.uint8)
            for cr in clean_page["regions"]:
                mask_member = cr.get("mask")
                if not mask_member:
                    continue
                mask_file = sources.get(mask_member, root / mask_member)
                if file_sha256(mask_file) != cr.get("maskSha256"):
                    raise ValueError(f"Mask digest changed: {mask_member}")
                mask_img = cv2.imdecode(np.fromfile(str(mask_file), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
                if mask_img is None or mask_img.shape != orig_img.shape[:2]:
                    raise ValueError(f"Invalid mask dimensions: {mask_member}")
                union |= mask_img
                archive.write(mask_file, mask_member, compress_type=zipfile.ZIP_STORED)
            if not np.array_equal(clean_img[union == 0], orig_img[union == 0]):
                raise ValueError(f"Pixels changed outside masks on page: {page['pageId']}")

    return dict(path=args["output"])


COMMANDS = {
    "normalize": normalize,
    "prepare": prepare,
    "erase": erase,
    "pack": pack,
}

if __name__ == "__main__":
    channel = Channel()
    reader = None
    try:
        header, _ = channel.read()
        reader = threading.Thread(target=channel.listen)
        reader.start()
        result = COMMANDS[header["command"]](header["args"], channel)
        channel.write({"result": True}, json.dumps(result, ensure_ascii=False).encode())
        reader.join()
    except BaseException as error:
        traceback.print_exc(file=sys.stderr)
        channel.write({"error": str(error)})
        sys.exit(1)
