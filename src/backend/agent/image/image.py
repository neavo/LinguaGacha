"""固定图片像素阶段。推理只经二进制通道，原稿和译文事实由调用方持有。"""

import importlib.util
import json
import math
import sys
import threading
import traceback
import hashlib
import zipfile
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(1)
_channel_path = Path(__file__).with_name("channel.py")
if not _channel_path.exists():
    _channel_path = Path(__file__).parent.parent / "inference" / "channel.py"
_spec = importlib.util.spec_from_file_location("inference_channel", _channel_path)
_channel = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_channel)
Channel = _channel.Channel
CONF, IOU, MAX_DET = 0.1, 0.7, 300  # 检测模型置信度、非极大值抑制与单页上限。
BACKGROUND_SPREAD = 20  # 判定背景均匀可纯色直填的通道四分位差阈值。
READING_ROW_RATIO, LAYOUT_EXPANSION_RATIO = 0.04, 0.25  # 阅读行分组高度比例与窄竖框留白扩展上限。
INPAINT_EDGE, CONTEXT_RATIO, CONTEXT_MIN, MODEL_STRIDE = 2048, 0.35, 64, 64  # 修复模型边长、上下文外扩与步长对齐约束。


def postprocess(raw, proto, shape, input_shape):
    """在模型边界恢复原图坐标，框和掩码使用同一缩放与补边。"""
    pred = raw[0].T
    labels = pred[:, 4:7].argmax(1)
    scores = pred[np.arange(len(pred)), labels + 4]
    candidates = np.flatnonzero(scores > CONF)
    candidates = candidates[np.argsort(-scores[candidates], kind="stable")][:30000]
    boxes = np.concatenate(
        (pred[:, :2] - pred[:, 2:4] / 2, pred[:, :2] + pred[:, 2:4] / 2), 1
    )
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
        [
            round((iw - round(w * gain)) / 2 - 0.1),
            round((ih - round(h * gain)) / 2 - 0.1),
        ]
        * 2
    )
    # LetterBox 逐边取整，反变换必须分别使用实际横纵比例。
    gains = np.array([max(round(w * gain), 1) / w, max(round(h * gain), 1) / h] * 2)
    scaled = (boxes[kept] - pad) / gains
    scaled[:, [0, 2]] = scaled[:, [0, 2]].clip(0, w)
    scaled[:, [1, 3]] = scaled[:, [1, 3]].clip(0, h)
    _, mh, mw = proto[0].shape
    mask_gain = min(4 * mh / h, 4 * mw / w)
    padding = (4 * mh - max(round(h * mask_gain), 1)) | (
        4 * mw - max(round(w * mask_gain), 1)
    )
    factor = 4 // math.gcd(4, padding | padding // 2)
    masks, records = [], []
    for i, box in zip(kept, scaled):
        logits = (pred[i, 7:] @ proto[0].reshape(32, -1)).reshape(mh, mw)
        if factor > 1:
            logits = cv2.resize(
                logits, (mw * factor, mh * factor), interpolation=cv2.INTER_LINEAR
            )
        sh, sw = logits.shape
        mg = min(sh / h, sw / w)
        ch, cw = max(round(h * mg), 1), max(round(w * mg), 1)
        top, left = round((sh - ch) / 2 - 0.1), round((sw - cw) / 2 - 0.1)
        mask = (
            cv2.resize(
                logits[top : top + ch, left : left + cw],
                (w, h),
                interpolation=cv2.INTER_LINEAR,
            )
            > 0
        )
        yy, xx = np.ogrid[:h, :w]
        mask &= (xx >= box[0]) & (xx < box[2]) & (yy >= box[1]) & (yy < box[3])
        if mask.any():
            masks.append(mask)
            records.append([*box, float(scores[i]), int(labels[i])])
    return np.array(records), masks


def extract_stroke_and_style(image, bbox):
    """隔离气泡内腔并提取笔画与风格；含描边光晕与半透明底纹的气泡整块纯色直填。"""
    img_h, img_w = image.shape[:2]
    x, y, w, h = (bbox[k] for k in ("x", "y", "width", "height"))
    roi = image[y : y + h, x : x + w]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    center = binary[h // 4 : h - h // 4 or h, w // 4 : w - w // 4 or w]
    fg_is_dark = np.mean(center == 255) >= 0.5
    fg_mask = 255 - binary if fg_is_dark else binary

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(fg_mask, connectivity=8)
    inner = np.zeros_like(fg_mask)
    fallback = np.zeros_like(fg_mask)
    border_dark = np.zeros_like(fg_mask)
    for idx in range(1, num_labels):
        cx, cy, cw, ch, area = stats[idx]
        if area < 2:
            continue
        touches_border = cx == 0 or cy == 0 or cx + cw >= w or cy + ch >= h
        if not touches_border:
            inner[labels == idx] = 255
        else:
            border_dark[labels == idx] = 255
            if cw < w * 0.95 or ch < h * 0.95:
                fallback[labels == idx] = 255

    stroke = inner if np.any(inner) else fallback
    if not np.any(stroke):
        stroke = fg_mask.copy()

    # 用触边画线作墙阻断框外五官与碎网点，只保留主体文字簇。
    if np.any(inner) and np.any(border_dark):
        bridge = max(6, round(min(w, h) * 0.18))
        wall = cv2.dilate(border_dark, np.ones((3, 3), np.uint8), iterations=1)
        bridged = cv2.dilate(
            stroke,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bridge * 2 + 1, bridge * 2 + 1)),
            iterations=1,
        )
        bridged = cv2.bitwise_and(bridged, 255 - wall)
        n_c, c_labels, _, _ = cv2.connectedComponentsWithStats(bridged, connectivity=8)
        if n_c > 2:
            counts = [int(np.sum((c_labels == i) & (stroke > 0))) for i in range(1, n_c)]
            max_cnt = max(counts, default=0)
            if max_cnt > 0:
                keep = np.zeros_like(stroke)
                for i, cnt in enumerate(counts, start=1):
                    if cnt >= max_cnt * 0.2:
                        keep[c_labels == i] = 255
                stroke = cv2.bitwise_and(stroke, keep)

    yy, xx = np.ogrid[:h, :w]
    in_oval = (
        ((xx - (w - 1) / 2.0) / max(1.0, w * 0.45)) ** 2
        + ((yy - (h - 1) / 2.0) / max(1.0, h * 0.45)) ** 2
    ) <= 1.0

    dist = cv2.distanceTransform((stroke == 0).astype(np.uint8) * 255, cv2.DIST_L2, 3)
    fg_dist = cv2.distanceTransform((stroke > 0).astype(np.uint8), cv2.DIST_L2, 3)
    stroke_r = (
        max(1.0, float(np.percentile(fg_dist[stroke > 0], 80)))
        if np.any(stroke > 0)
        else 1.5
    )

    # 在内接椭圆远距净空区采样环境底色，避开白边光晕与外角背景。
    valid_oval = (fg_mask == 0) & in_oval
    if not np.any(valid_oval):
        valid_oval = stroke == 0
    if np.any(valid_oval):
        d60, d95 = np.percentile(dist[valid_oval], [60, 95])
        amb_mask = valid_oval & (dist >= d60) & (dist <= max(d60 + 1.0, d95))
    else:
        d60 = stroke_r * 2.0
        amb_mask = np.ones((h, w), dtype=bool)
    bg = np.median(roi[amb_mask], axis=0).round().astype(np.uint8)

    # 提取与环境底色连通的气泡内腔，并将内腔包围的全部内部空洞一并归入内腔。
    diff_bg = np.max(np.abs(roi.astype(np.int32) - bg.astype(np.int32)), axis=2)
    bg_like = ((diff_bg <= 48) & (fg_mask == 0)).astype(np.uint8) * 255
    _, b_labels, _, _ = cv2.connectedComponentsWithStats(bg_like, connectivity=8)
    center_slice = b_labels[
        h // 5 : max(h // 5 + 1, 4 * h // 5), w // 5 : max(w // 5 + 1, 4 * w // 5)
    ]
    center_ids = set(np.unique(center_slice)) - {0}
    if center_ids:
        cavity_bg = np.isin(b_labels, list(center_ids)).astype(np.uint8) * 255
    else:
        cavity_bg = bg_like

    ff = (255 - cavity_bg).copy()
    ff_mask = np.zeros((h + 2, w + 2), np.uint8)
    for bx in range(w):
        if ff[0, bx] == 255:
            cv2.floodFill(ff, ff_mask, (bx, 0), 128)
        if ff[h - 1, bx] == 255:
            cv2.floodFill(ff, ff_mask, (bx, h - 1), 128)
    for by in range(h):
        if ff[by, 0] == 255:
            cv2.floodFill(ff, ff_mask, (0, by), 128)
        if ff[by, w - 1] == 255:
            cv2.floodFill(ff, ff_mask, (w - 1, by), 128)

    cavity = ((cavity_bg > 0) | (ff == 255)) & (border_dark == 0)
    if np.sum(cavity) < h * w * 0.15:
        cavity = (in_oval | (stroke > 0)) & (border_dark == 0)

    stroke_in_cav = cv2.bitwise_and(stroke, cavity.astype(np.uint8) * 255)
    if np.any(stroke_in_cav):
        stroke = stroke_in_cav
        dist = cv2.distanceTransform((stroke == 0).astype(np.uint8) * 255, cv2.DIST_L2, 3)

    # 使用有向光晕差值检测描边光晕，避免线性渐变背景被误判为白边光晕。
    near_mask = (
        (fg_mask == 0) & cavity & (dist >= 1.0) & (dist <= max(2.5, stroke_r * 1.2))
    )
    if np.any(near_mask):
        near_col = np.percentile(roi[near_mask], 80 if fg_is_dark else 20, axis=0)
    else:
        near_col = bg.astype(np.float64)
    signed_halo = (
        float(np.max(near_col.astype(np.float64) - bg.astype(np.float64)))
        if fg_is_dark
        else float(np.max(bg.astype(np.float64) - near_col.astype(np.float64)))
    )
    halo_diff = signed_halo if signed_halo > 8.0 else 0.0

    base_rad = max(1.5, min(6.0, stroke_r * 1.2))
    base_dil = ((dist <= base_rad) & cavity).astype(np.uint8) * 255

    if halo_diff > 8.0:
        diff_near = np.max(np.abs(roi.astype(np.float64) - near_col), axis=2)
        halo_cand = (
            cavity
            & (dist <= max(float(d60), stroke_r * 4.5))
            & (diff_bg > max(8.0, halo_diff * 0.28))
            & (diff_near <= diff_bg * 1.25)
        ).astype(np.uint8) * 255
        combined = cv2.bitwise_or(base_dil, halo_cand)
        _, m_labels = cv2.connectedComponents(combined, connectivity=8)
        seeded_ids = set(np.unique(m_labels[base_dil > 0])) - {0}
        full_mask = np.isin(m_labels, list(seeded_ids)).astype(np.uint8) * 255
        pad_r = max(1, min(4, round(stroke_r * 0.6)))
        full_mask = cv2.dilate(
            full_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad_r * 2 + 1, pad_r * 2 + 1)),
            iterations=1,
        )
        close_r = max(4, round(min(w, h) * 0.08))
        closed_block = cv2.morphologyEx(
            full_mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (close_r * 2 + 1, close_r * 2 + 1)
            ),
        )
        full_mask = cv2.bitwise_and(closed_block, cavity.astype(np.uint8) * 255)
    else:
        full_mask = base_dil

    clean_amb = amb_mask & (full_mask == 0) & (fg_mask == 0)
    if np.sum(clean_amb) < max(10, round(np.sum(amb_mask) * 0.2)):
        clean_amb = amb_mask
    clean_cav = cavity & (full_mask == 0) & (fg_mask == 0)

    def calc_iqr(m):
        """计算掩码区域内各颜色通道的最大四分位差，衡量背景纹理复杂度。"""
        pts = roi[m]
        if not len(pts):
            return 0.0
        q75, q25 = np.percentile(pts, [75, 25], axis=0)
        return float(np.max(q75 - q25))

    iqr = (
        min(calc_iqr(clean_amb), calc_iqr(clean_cav))
        if np.sum(clean_cav) >= 10
        else calc_iqr(clean_amb)
    )

    # 带框半透明或含白边气泡：整块填平气泡内腔并走纯色直填，不送入 LaMa 涂抹。
    is_bordered_bubble = bool(np.any(border_dark)) and (iqr <= 36.0 or halo_diff > 8.0)
    if is_bordered_bubble and (iqr > 6.0 or halo_diff > 8.0):
        inner_cavity = cv2.erode(
            cavity.astype(np.uint8) * 255, np.ones((3, 3), np.uint8), iterations=1
        )
        full_mask = cv2.bitwise_or(full_mask, inner_cavity)

    spread = min(18.0, iqr) if is_bordered_bubble else iqr

    if np.any(stroke > 0):
        stroke_pts = roi[stroke > 0]
        stroke_g = gray[stroke > 0]
        if fg_is_dark:
            q = np.percentile(stroke_g, 35)
            core_pts = stroke_pts[stroke_g <= q]
        else:
            q = np.percentile(stroke_g, 65)
            core_pts = stroke_pts[stroke_g >= q]
        fg = np.median(core_pts if len(core_pts) else stroke_pts, axis=0).round().astype(np.uint8)
        if fg_is_dark and np.mean(fg) > 60 and np.ptp(fg) <= 35:
            fg = (fg * 0.25).round().astype(np.uint8)
    else:
        fg = 255 - bg

    mask = np.zeros((img_h, img_w), np.uint8)
    mask[y : y + h, x : x + w] = full_mask
    return mask, bg, fg, spread, stroke


def read_image(file):
    """保留位深和透明度拒绝条件，再按 EXIF 方向规范化像素。"""
    encoded = np.fromfile(file, np.uint8)
    raw = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if raw is None or raw.dtype != np.uint8 or raw.ndim not in (2, 3):
        raise ValueError("Unsupported image encoding")
    if raw.ndim == 3 and raw.shape[2] == 4 and np.any(raw[:, :, 3] != 255):
        raise ValueError("Transparent input is unsupported")
    # IMREAD_COLOR 按 EXIF 方向归一化，原始字节由 SDK 另外保存。
    del raw  # 完成位深与透明度检查后释放首次解码的像素。
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image.shape[0] * image.shape[1] > 100_000_000:
        raise ValueError("Image pixel budget exceeded")
    return image


def save(file, image):
    """PNG 编码成功后才写出当前像素结果。"""
    Path(file).parent.mkdir(parents=True, exist_ok=True)
    ok, data = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("PNG encoding failed")
    data.tofile(str(file))
    return str(Path(file).resolve())


def forward(channel, kind, data):
    """经共享通道请求固定模型，按返回形状恢复张量。"""
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


def select_candidate_boxes(boxes, masks):
    """沿狭窄瓶颈自动切分双连体气泡，并补充未被气泡覆盖的独立文字候选框。"""
    selected = []
    for i, box in enumerate(boxes):
        if int(box[5]) != 2 or float(box[4]) < 0.25:
            continue
        x0, y0, x1, y1 = (int(round(v)) for v in box[:4])
        bw, bh = x1 - x0, y1 - y0
        if bh > bw * 1.8 and bh >= 60 and i < len(masks):
            m_crop = masks[i][y0:y1, x0:x1] > 0.5
            row_w = np.sum(m_crop, axis=1)
            mh = len(row_w)
            if mh >= 40:
                top_peak = int(np.max(row_w[: mh // 2]))
                bot_peak = int(np.max(row_w[mh // 2 :]))
                neck_rel = mh // 4 + int(np.argmin(row_w[mh // 4 : 3 * mh // 4]))
                neck_w = int(row_w[neck_rel])
                if (
                    min(top_peak, bot_peak) > bw * 0.35
                    and neck_w / max(1, min(top_peak, bot_peak)) < 0.68
                ):
                    y_split = y0 + neck_rel
                    selected.append(
                        np.array([x0, y0, x1, y_split, box[4], 2], dtype=np.float32)
                    )
                    selected.append(
                        np.array([x0, y_split, x1, y1, box[4], 2], dtype=np.float32)
                    )
                    continue
        selected.append(box)

    for box in boxes:
        if int(box[5]) != 1 or float(box[4]) < 0.35:
            continue
        tx0, ty0, tx1, ty1 = box[:4]
        t_area = max(1.0, float((tx1 - tx0) * (ty1 - ty0)))
        covered = False
        for sb in selected:
            bx0, by0, bx1, by1 = sb[:4]
            b_area = max(1.0, float((bx1 - bx0) * (by1 - by0)))
            ix0, iy0 = max(tx0, bx0), max(ty0, by0)
            ix1, iy1 = min(tx1, bx1), min(ty1, by1)
            if ix1 > ix0 and iy1 > iy0:
                inter = float((ix1 - ix0) * (iy1 - iy0))
                if inter / min(t_area, b_area) > 0.3:
                    covered = True
                    break
        if not covered:
            selected.append(box)

    return selected


def prepare(args, channel):
    """检测只生成候选与证据，确认权归草稿提交者。"""
    image = read_image(args["source"])
    h, w = image.shape[:2]
    root = Path(args["output"])
    root.mkdir(parents=True, exist_ok=True)
    save(root / "original.png", image)
    gain = 1280 / max(h, w)
    nh, nw = round(h * gain), round(w * gain)
    resized = cv2.resize(image, (nw, nh))
    ih, iw = math.ceil(nh / 32) * 32, math.ceil(nw / 32) * 32
    top, left = round((ih - nh) / 2 - 0.1), round((iw - nw) / 2 - 0.1)
    padded = cv2.copyMakeBorder(
        resized,
        top,
        ih - nh - top,
        left,
        iw - nw - left,
        cv2.BORDER_CONSTANT,
        value=(114, 114, 114),
    )
    raw, proto = forward(
        channel,
        "shadow",
        padded[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255,
    )
    boxes, masks = postprocess(raw, proto, (h, w), (ih, iw))
    preview = image.copy()
    candidates, regions = [], []
    # 按行排序并在竖排页内从右向左，阅读顺序仍由看图确认。
    texts = select_candidate_boxes(boxes, masks)
    vertical = sum(box[3] - box[1] > box[2] - box[0] for box in texts) > len(texts) / 2
    texts.sort(
        key=lambda box: (
            round(box[1] / max(1, h * READING_ROW_RATIO)),
            -box[0] if vertical else box[0],
        )
    )
    for index, box in enumerate(texts, 1):
        x0, y0, x1, y1, score, _ = box
        x0, y0 = max(0, math.floor(x0)), max(0, math.floor(y0))
        x1, y1 = min(w, math.ceil(x1)), min(h, math.ceil(y1))
        if x1 <= x0 or y1 <= y0:
            continue
        region_id = f"r{index}"
        bbox = dict(x=x0, y=y0, width=x1 - x0, height=y1 - y0)
        regions.append(
            dict(
                regionId=region_id,
                disposition="translate",
                bbox=bbox,
                direction="vertical-rl" if y1 - y0 > x1 - x0 else "horizontal-tb",
            )
        )
        candidates.append(
            dict(regionId=region_id, score=float(score), uncertain=bool(score < 0.25))
        )
        cv2.rectangle(
            preview, (x0, y0), (x1, y1), (0, 0, 255), max(1, round(max(h, w) / 1000))
        )
        cv2.putText(
            preview,
            region_id,
            (x0, max(20, y0)),
            0,
            max(0.5, max(h, w) / 1800),
            (0, 0, 255),
            2,
        )
    scale = min(1, 1600 / max(h, w))
    save(
        root / "preview.png", cv2.resize(preview, (round(w * scale), round(h * scale)))
    )
    return dict(
        width=w,
        height=h,
        candidates=candidates,
        regions=regions,
        preview=str((root / "preview.png").resolve()),
        previewScale=scale,
    )


def repair(args, channel):
    """同页修复共用填色快照，每个区域保留独立的笔画掩码。"""
    page = args["page"]
    root = Path(args["output"])
    root.mkdir(parents=True, exist_ok=True)
    image = read_image(args["source"])
    h, w = image.shape[:2]
    if (w, h) != (page["width"], page["height"]):
        raise ValueError("Page dimensions differ from original")
    base = image.copy()
    occupied = np.zeros((h, w), np.uint8)
    masks, regions, jobs = {}, [], []
    for region in page["regions"]:
        rid = region["regionId"]
        mask, bg, fg, spread, _ = extract_stroke_and_style(image, region["bbox"])
        reason = None
        if region["disposition"] == "preserve":
            mask[:] = 0
            reason = "preserve"
        elif not mask.any():
            reason = "no_text_strokes"
        if np.any((occupied > 0) & (mask > 0)):
            raise ValueError("Text regions overlap; correct their bounding boxes")
        occupied |= mask
        masks[rid] = mask
        if reason is None:
            if spread <= BACKGROUND_SPREAD:
                base[mask > 0] = bg
            else:
                jobs.append(rid)
        regions.append(
            dict(
                regionId=rid,
                ready=reason is None,
                reason=reason,
                mask=save(root / f"{rid}-mask.png", mask),
            )
        )
    # 所有裁图读取同一个填色底图与全页掩码，只有所属区域的笔画像素回贴。
    scale = min(1, INPAINT_EDGE / max(h, w))
    sh, sw = round(h * scale), round(w * scale)
    union = np.zeros((h, w), np.uint8)
    for rid in jobs:
        union |= masks[rid]
    snapshot = cv2.resize(base, (sw, sh), interpolation=cv2.INTER_CUBIC)
    scaled_mask = cv2.resize(union, (sw, sh), interpolation=cv2.INTER_AREA) > 0
    scaled_mask = cv2.dilate(scaled_mask.astype(np.uint8), np.ones((3, 3), np.uint8))
    crops = []
    for rid in jobs:
        x, y, bw, bh = cv2.boundingRect(masks[rid])
        margin = max(CONTEXT_MIN, round(max(bw, bh) * CONTEXT_RATIO))
        x0 = max(0, math.floor((x - margin) * sw / w))
        y0 = max(0, math.floor((y - margin) * sh / h))
        x1 = min(sw, math.ceil((x + bw + margin) * sw / w))
        y1 = min(sh, math.ceil((y + bh + margin) * sh / h))
        crops.append((x0, y0, x1, y1, [rid]))
    padded = lambda v: math.ceil(v / MODEL_STRIDE) * MODEL_STRIDE  # 向上对齐模型步长。
    if (
        sum(padded(x1 - x0) * padded(y1 - y0) for x0, y0, x1, y1, _ in crops)
        >= padded(sw) * padded(sh)
        and jobs
    ):
        crops = [(0, 0, sw, sh, jobs)]
    for x0, y0, x1, y1, owners in crops:
        crop = snapshot[y0:y1, x0:x1]
        mask = scaled_mask[y0:y1, x0:x1]
        ch, cw = mask.shape
        ph, pw = padded(ch) - ch, padded(cw) - cw
        rgb = (
            cv2.copyMakeBorder(crop, 0, ph, 0, pw, cv2.BORDER_REFLECT)[
                :, :, ::-1
            ].astype(np.float32)
            / 255
        )
        m = cv2.copyMakeBorder(mask, 0, ph, 0, pw, cv2.BORDER_CONSTANT).astype(
            np.float32
        )
        output = forward(
            channel,
            "inpaint",
            np.concatenate([rgb.transpose(2, 0, 1), m[None]], axis=0)[None],
        )[0]
        restored = output[0].transpose(1, 2, 0)[:ch, :cw, ::-1] * 255
        # LaMa 输出为 0..1，回贴保持全页缩放网格的像素中心。
        for rid in owners:
            yy, xx = np.nonzero(masks[rid])
            mapx = ((xx + 0.5) * sw / w - 0.5 - x0).astype(np.float32)
            mapy = ((yy + 0.5) * sh / h - 0.5 - y0).astype(np.float32)
            for start in range(0, len(xx), 16000):
                stop = start + 16000
                sampled = cv2.remap(
                    restored,
                    mapx[start:stop].reshape(-1, 1),
                    mapy[start:stop].reshape(-1, 1),
                    cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REPLICATE,
                ).reshape(-1, 3)
                base[yy[start:stop], xx[start:stop]] = (
                    sampled.clip(0, 255).round().astype(np.uint8)
                )
    if not np.array_equal(base[occupied == 0], image[occupied == 0]):
        raise ValueError("Pixels changed outside edit masks")
    return dict(base=save(root / "base.png", base), regions=regions)


def layout(args, _channel):
    """内接安全排版框与自适应字号上限计算，窄竖框仅向同色留白扩展。"""
    page = args["page"]
    image = read_image(args["source"])
    regions = []
    for region in page["regions"]:
        if region["disposition"] != "translate":
            continue
        bbox = region["bbox"]
        x, y, w, h = (bbox[k] for k in ("x", "y", "width", "height"))
        _, bg, fg, spread, stroke_crop = extract_stroke_and_style(image, bbox)
        vertical = region["direction"] == "vertical-rl"
        _, _, stats, _ = cv2.connectedComponentsWithStats(stroke_crop, 8)
        limit = (w if vertical else h) * 0.9
        spans = [
            (cw if vertical else ch)
            for _, _, cw, ch, area in stats[1:]
            if area >= 4 and (cw if vertical else ch) <= limit
        ]

        # 基于原始文字核心包围盒收敛内接安全排版框；小尺寸低清区域不内缩以免文字放不下。
        lx, ly, lw, lh = x, y, w, h
        if min(w, h) >= 80 and np.any(stroke_crop > 0):
            sx, sy, sw, sh = cv2.boundingRect(stroke_crop)
            cx = sx + sw / 2.0
            cy = sy + sh / 2.0
            pad_x = round(w * 0.07)
            pad_y = round(h * 0.08)
            cap_w = max(1, w - pad_x * 2)
            cap_h = max(1, h - pad_y * 2)
            if vertical:
                lh = min(cap_h, max(round(sh * 1.08), round(h * 0.62)))
                lw = min(cap_w, max(round(sw * 1.25), round(w * 0.72)))
            else:
                lw = min(cap_w, max(round(sw * 1.08), round(w * 0.72)))
                lh = min(cap_h, max(round(sh * 1.25), round(h * 0.72)))
            lx = x + int(round(np.clip(cx - lw / 2.0, pad_x, max(pad_x, w - pad_x - lw))))
            ly = y + int(round(np.clip(cy - lh / 2.0, pad_y, max(pad_y, h - pad_y - lh))))

        if spread <= BACKGROUND_SPREAD and vertical and h > w * 2:
            # 只松弛横向纯色留白，不跨页边、画线或另一个区域。
            for _ in range(round(w * LAYOUT_EXPANSION_RATIO)):
                for side in (-1, 1):
                    col = lx - 1 if side < 0 else lx + lw
                    if col < 0 or col >= image.shape[1]:
                        continue
                    overlaps = any(
                        other["regionId"] != region["regionId"]
                        and other["bbox"]["x"]
                        <= col
                        < other["bbox"]["x"] + other["bbox"]["width"]
                        and other["bbox"]["y"] < ly + lh
                        and other["bbox"]["y"] + other["bbox"]["height"] > ly
                        for other in page["regions"]
                    )
                    if (
                        not overlaps
                        and np.max(
                            np.abs(image[ly : ly + lh, col].astype(int) - bg.astype(int))
                        )
                        <= BACKGROUND_SPREAD
                    ):
                        lx -= side < 0
                        lw += 1

        scale = 1.25 if vertical else 1.6
        default_fs = (
            max(8, round(float(np.percentile(spans, 80)) * scale))
            if spans
            else max(12, round(min(lw, lh) * 0.22))
        )
        min_fs = 5 if min(lw, lh) < 45 else 8

        color = lambda value: "#" + "".join(f"{int(c):02x}" for c in value[::-1])  # BGR 转十六进制 RGB。
        style = dict(
            color=color(fg),
            stroke=color(bg),
            strokeWidth=0 if spread <= BACKGROUND_SPREAD else 1,
            weight=400,
            rotation=0,
            minFontSize=min_fs,
            align="center",
            fontSize=default_fs,
        )
        style.update(region.get("style") or {})
        regions.append(
            dict(
                regionId=region["regionId"],
                x=int(lx),
                y=int(ly),
                width=int(lw),
                height=int(lh),
                style=style,
            )
        )
    return regions


def composite(args, _channel):
    """先核对全部文字层，再按区域恢复失败结果。"""
    original = read_image(args["source"])
    base = read_image(args["base"])
    result = original.copy()
    occupied = np.zeros(original.shape[:2], np.int32)
    rejected = set()
    # 先核对全部文字层，再按区域决定底图与文字能否一起交付。
    for index, region in enumerate(args["regions"], 1):
        if not region["accepted"]:
            continue
        for tile in region["tiles"]:
            layer = cv2.imdecode(
                np.fromfile(tile["path"], np.uint8), cv2.IMREAD_UNCHANGED
            )
            th, tw = layer.shape[:2]
            x, y = tile["x"], tile["y"]
            active = layer[:, :, 3] > 8
            local = occupied[y : y + th, x : x + tw]
            if local.shape != active.shape:
                raise ValueError("Layer outside page")
            owners = np.unique(local[active & (local > 0)])
            if len(owners):
                rejected.add(index)
                rejected.update(int(owner) for owner in owners)
            local[active] = index
    for index, region in enumerate(args["regions"], 1):
        if not region["accepted"] or index in rejected:
            continue
        mask = (
            cv2.imdecode(np.fromfile(region["mask"], np.uint8), cv2.IMREAD_GRAYSCALE)
            > 0
        )
        result[mask] = base[mask]
        for tile in region["tiles"]:
            layer = cv2.imdecode(
                np.fromfile(tile["path"], np.uint8), cv2.IMREAD_UNCHANGED
            )
            th, tw = layer.shape[:2]
            x, y = tile["x"], tile["y"]
            alpha = layer[:, :, 3].astype(np.float32) / 255
            local = result[y : y + th, x : x + tw]
            local[:] = (
                (layer[:, :, :3] * alpha[:, :, None] + local * (1 - alpha[:, :, None]))
                .round()
                .astype(np.uint8)
            )
    return dict(
        path=save(args["output"], result),
        rejectedRegions=[
            args["regions"][index - 1]["regionId"] for index in sorted(rejected)
        ],
    )


def pack(args, _channel):
    """逐成员写临时包，原件摘要核对失败就停止归档。"""
    root = Path(args["root"])
    book = args["book"]
    records = args["records"]
    with zipfile.ZipFile(args["output"], "x", allowZip64=False) as archive:
        archive.writestr(
            "image.json",
            json.dumps(book, ensure_ascii=False),
            compress_type=zipfile.ZIP_DEFLATED,
        )
        archive.writestr(
            "items.json",
            json.dumps(records, ensure_ascii=False),
            compress_type=zipfile.ZIP_DEFLATED,
        )
        members = {page["original"]: page["sha256"] for page in book["pages"]}
        for name, sha256 in members.items():
            file = root / name
            with file.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != sha256:
                    raise ValueError("Original digest changed")
            archive.write(file, name, compress_type=zipfile.ZIP_STORED)
    return dict(path=args["output"])


if __name__ == "__main__":
    channel = Channel()
    reader = None
    try:
        header, _ = channel.read()
        reader = threading.Thread(target=channel.listen)
        reader.start()
        result = {
            "prepare": prepare,
            "repair": repair,
            "layout": layout,
            "composite": composite,
            "pack": pack,
        }[header["command"]](header["args"], channel)
        channel.write({"result": True}, json.dumps(result, ensure_ascii=False).encode())
        reader.join()  # 父进程收到结果后关闭 stdin，必须等读线程退出才结束解释器。
    except BaseException as error:
        traceback.print_exc(file=sys.stderr)
        channel.write({"error": str(error)})
        sys.exit(1)
