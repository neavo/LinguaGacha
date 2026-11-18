"""区域检测、自动消字、文字分区与离线归档。推理由宿主 Worker 执行。"""

import base64
import hashlib
import json
import math
import sys
import threading
import traceback
from itertools import groupby
from pathlib import Path

import cv2
import numpy as np

from lg.inference import ocr
from lg.inference.channel import Channel

# 隔离模式不含脚本目录，从技能目录导入同包模块。
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fill
import repair

cv2.setNumThreads(1)
IMAGE_SIZE, MODEL_STRIDE = 1600, 32
CONF, IOU, MAX_DET, MAX_NMS = 0.25, 0.7, 300, 30000
UNFRAMED_PADDING_RATIO = 0.5
SCAN_PREVIEW_EDGE = 1600
TEXT_MARGIN = 2
QA_WEBP_QUALITY = 85


def read_image(path):
    """读取宿主已规范化的 RGB PNG，返回 OpenCV 使用的 BGR 像素。"""
    encoded = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if (
        image is None
        or image.dtype != np.uint8
        or image.ndim != 3
        or image.shape[2] != 3
    ):
        raise ValueError(f"Expected normalized RGB image: {path}")
    if image.shape[0] * image.shape[1] > 100_000_000:
        raise ValueError("Image pixel budget exceeded")
    return image


def save(file, image, extension=".png", parameters=()):
    """编码成功后写出磁盘并返回解析路径。"""
    ok, data = cv2.imencode(extension, image, parameters)
    if not ok:
        raise ValueError(f"Image encoding failed: {extension}")
    output = Path(file)
    output.parent.mkdir(parents=True, exist_ok=True)
    data.tofile(str(output))
    return str(output.resolve())


def forward(channel, kind, data):
    """恢复气泡模型张量并校验通道长度。"""
    header, payload = channel.request(kind, data).result()
    values = np.frombuffer(payload, np.float32)
    results, offset = [], 0
    for shape in header["shapes"]:
        count = math.prod(shape)
        results.append(values[offset : offset + count].reshape(shape))
        offset += count
    if offset != len(values):
        raise ValueError("Invalid image model response")
    return results


def model_input(image):
    """按 Ultralytics letterbox 放大与补边，空间尺寸对齐模型步长。"""
    h, w = image.shape[:2]
    gain = IMAGE_SIZE / max(h, w)
    rh, rw = round(h * gain), round(w * gain)
    ph, pw = (IMAGE_SIZE - rh) % MODEL_STRIDE, (IMAGE_SIZE - rw) % MODEL_STRIDE
    resized = cv2.resize(image, (rw, rh), interpolation=cv2.INTER_LINEAR)
    padded = cv2.copyMakeBorder(
        resized,
        round(ph / 2 - 0.1),
        round(ph / 2 + 0.1),
        round(pw / 2 - 0.1),
        round(pw / 2 + 0.1),
        cv2.BORDER_CONSTANT,
        value=(114, 114, 114),
    )
    return (
        np.ascontiguousarray(
            padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32
        )
        / 255
    )


def postprocess(raw, proto, shape, input_shape):
    """复现 Ultralytics retina_masks：先恢复 logits，再裁框及二值化，逐实例释放整页数组。"""
    ih, iw = input_shape
    # Worker 已校验原生输出的布局与有限值，通道只传连续 float32。
    pred = raw[0].T
    scores = pred[:, 4]
    candidates = np.flatnonzero(scores > CONF)
    candidates = candidates[np.argsort(-scores[candidates], kind="stable")][:MAX_NMS]
    boxes = np.concatenate(
        (pred[:, :2] - pred[:, 2:4] / 2, pred[:, :2] + pred[:, 2:4] / 2), 1
    )
    area = (boxes[:, 2:] - boxes[:, :2]).prod(1)
    kept = []
    while len(candidates) and len(kept) < MAX_DET:
        i, candidates = candidates[0], candidates[1:]
        kept.append(i)
        inter = np.maximum(
            0,
            np.minimum(boxes[i, 2:], boxes[candidates, 2:])
            - np.maximum(boxes[i, :2], boxes[candidates, :2]),
        ).prod(1)
        overlap = inter / (area[i] + area[candidates] - inter + 1e-7)
        candidates = candidates[overlap <= IOU]
    h, w = shape
    gain = min(ih / h, iw / w)
    pad = np.array(
        [round((iw - w * gain) / 2 - 0.1), round((ih - h * gain) / 2 - 0.1)] * 2
    )
    scaled = (boxes[kept] - pad) / gain
    scaled[:, [0, 2]] = scaled[:, [0, 2]].clip(0, w)
    scaled[:, [1, 3]] = scaled[:, [1, 3]].clip(0, h)
    _, mh, mw = proto[0].shape
    mg = min(mh / h, mw / w)
    pad_w, pad_h = (mw - w * mg) / 2, (mh - h * mg) / 2
    top, left = round(pad_h - 0.1), round(pad_w - 0.1)
    bottom, right = mh - round(pad_h + 0.1), mw - round(pad_w + 0.1)
    for i, box in zip(kept, scaled):
        logits = (pred[i, 5:] @ proto[0].reshape(32, -1)).reshape(mh, mw)
        mask = (
            cv2.resize(
                logits[top:bottom, left:right], (w, h), interpolation=cv2.INTER_LINEAR
            )
            > 0
        )
        # 固定参考为 CPU retina_masks。该实现少于 50 个实例时用四舍五入后的框裁剪。
        if len(kept) < 50:
            x0, y0, x1, y1 = np.round(box).astype(int)
            mask[:y0] = False
            mask[y1:] = False
            mask[:, :x0] = False
            mask[:, x1:] = False
        else:
            yy, xx = np.ogrid[:h, :w]
            mask &= (xx >= box[0]) & (xx < box[2]) & (yy >= box[1]) & (yy < box[3])
        yield (
            dict(box=box.tolist(), score=float(scores[i])),
            mask.astype(np.uint8) * 255,
        )


def read_layout_area(file, shape):
    """解码并校验程序生成的二值排版区域。"""
    encoded = np.fromfile(str(file), dtype=np.uint8)
    mask = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if mask is None or mask.dtype != np.uint8 or mask.shape != shape:
        raise ValueError("Invalid binary selection dimensions")
    if not np.all((mask == 0) | (mask == 255)) or not np.any(mask):
        raise ValueError("Layout area must be nonempty and binary")
    return mask


def detect_text(image, channel):
    """整页等比缩放到 1280 像素预算后检测一次。"""
    tensor = ocr.image_detection_input(image)
    (probability,) = forward(channel, "detection", tensor)
    return ocr.image_detection_records(probability, *image.shape[:2])


def recognize_text(image, box, channel):
    """从原图裁字，竖排逆时针旋转后按高 48 像素识别。"""
    points = np.asarray(box, np.float32)
    x0 = max(0, math.floor(points[:, 0].min()))
    y0 = max(0, math.floor(points[:, 1].min()))
    x1 = min(image.shape[1], math.ceil(points[:, 0].max()))
    y1 = min(image.shape[0], math.ceil(points[:, 1].max()))
    crop = image[y0:y1, x0:x1]
    if not crop.size:
        return "", 0.0
    if crop.shape[0] > crop.shape[1]:
        crop = cv2.rotate(crop, cv2.ROTATE_90_COUNTERCLOCKWISE)
    tensor = ocr.recognition_input(crop)
    header, payload = channel.request("recognition", tensor).result()
    if payload:
        raise ValueError("Recognition response must not contain a payload")
    text = header.get("text")
    if not isinstance(text, str):
        raise ValueError("Invalid recognition response")
    return text.strip()


def box_metrics(box):
    """返回轴对齐范围与最小外接矩形的横、竖边长度。"""
    points = np.asarray(box, np.float32)
    xs, ys = points[:, 0], points[:, 1]
    return (
        float(xs.min()),
        float(ys.min()),
        float(xs.max()),
        float(ys.max()),
        float(np.linalg.norm(points[0] - points[1])),
        float(np.linalg.norm(points[0] - points[3])),
    )


def interval_gap(a0, a1, b0, b1):
    return max(0.0, max(a0, b0) - min(a1, b1))


def interval_overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def text_angle(box):
    """把 OCR 框的反向边折到同一角度，供相邻文字比较。"""
    edge = np.asarray(box, np.float32)[1] - np.asarray(box, np.float32)[0]
    angle = math.degrees(math.atan2(float(edge[1]), float(edge[0]))) % 180
    return min(angle, 180 - angle)


def adjacent_text(left, right):
    """按方向、投影、间距与短边尺度判断两个无框文字框是否同组。"""
    lx0, ly0, lx1, ly1, lw, lh = box_metrics(left["box"])
    rx0, ry0, rx1, ry1, rw, rh = box_metrics(right["box"])
    left_vertical, right_vertical = lh > lw * 1.5, rh > rw * 1.5
    if (
        left_vertical != right_vertical
        or abs(text_angle(left["box"]) - text_angle(right["box"])) > 15
    ):
        return False
    short_left, short_right = min(lw, lh), min(rw, rh)
    if max(short_left, short_right) > max(1.0, min(short_left, short_right)) * 2:
        return False
    if left_vertical:
        along = interval_overlap(ly0, ly1, ry0, ry1) / max(
            1.0, min(ly1 - ly0, ry1 - ry0)
        )
        return along >= 0.5 and interval_gap(lx0, lx1, rx0, rx1) <= max(lw, rw) * 1.5
    same_line = (
        interval_overlap(ly0, ly1, ry0, ry1) / max(1.0, min(ly1 - ly0, ry1 - ry0))
        >= 0.5
        and interval_gap(lx0, lx1, rx0, rx1) <= max(lh, rh) * 1.5
    )
    stacked = (
        interval_overlap(lx0, lx1, rx0, rx1) / max(1.0, min(lx1 - lx0, rx1 - rx0))
        >= 0.3
        and interval_gap(ly0, ly1, ry0, ry1) <= max(lh, rh) * 1.2
    )
    return same_line or stacked


def group_unframed(records):
    """用并查集合并相邻无框文字，规则只依赖本页几何。"""
    parent = list(range(len(records)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for left in range(len(records)):
        for right in range(left + 1, len(records)):
            a, b = find(left), find(right)
            if a != b and adjacent_text(records[left], records[right]):
                parent[b] = a
    groups = {}
    for index, record in enumerate(records):
        groups.setdefault(find(index), []).append(record)
    return list(groups.values())


def text_direction(records):
    """横竖排票数相同时沿用漫画竖排顺序。"""
    vertical = sum(
        box_metrics(record["box"])[5] > box_metrics(record["box"])[4] * 1.5
        for record in records
    )
    return "vertical-rl" if vertical * 2 >= len(records) else "horizontal-tb"


def ordered_text(records, direction):
    """区域内横排从上到下、竖排从右到左，并保留 OCR 行边界。"""
    if direction == "vertical-rl":
        records.sort(
            key=lambda record: (
                -box_metrics(record["box"])[0],
                box_metrics(record["box"])[1],
            )
        )
    else:
        records.sort(
            key=lambda record: (
                box_metrics(record["box"])[1],
                box_metrics(record["box"])[0],
            )
        )
    return "\n".join(record["text"] for record in records)


def owner_for_text(record, occupied):
    """气泡至少覆盖一半文字框才取得归属，避免误收邻近的无框字。"""
    support = np.zeros(occupied.shape, np.uint8)
    cv2.fillConvexPoly(support, np.asarray(record["box"], np.int32), 255)
    pixels = np.count_nonzero(support)
    if not pixels:
        return None
    ids, counts = np.unique(occupied[support > 0], return_counts=True)
    ranked = [(int(count), int(owner)) for owner, count in zip(ids, counts) if owner]
    if not ranked:
        return None
    count, owner = max(ranked)
    return owner if count >= pixels * 0.5 else None


def _background_color(image, selection, text_mask):
    """复杂背景用区域中位色估算译文字色。"""
    background, color = fill.analyze_background(image, selection, text_mask)
    if color is None:
        pixels = image[selection > 0]
        if not len(pixels):
            raise ValueError("Empty region selection")
        color = np.median(pixels, axis=0).round().astype(np.uint8)[::-1].tolist()
    return background, color


def _text_candidate(region_id, group, kind, lines):
    """扫描和纠错共用区域原文与 OCR 框的组织方式。"""
    direction = text_direction(lines)
    message = ordered_text(lines, direction)
    return {
        "regionId": region_id,
        "group": group,
        "kind": kind,
        "direction": direction,
        "message": message,
        "lines": [
            {
                "textBoxId": line["textBoxId"],
                "box": np.asarray(line["box"], np.int32).tolist(),
                "coreBox": np.asarray(line["coreBox"], np.int32).tolist(),
                "text": line["text"],
            }
            for line in lines
        ],
    }


def scan_page(spec, root, channel):
    """先识别和分格。区域编号在选字前确定。"""
    image = read_image(spec["source"])
    h, w = image.shape[:2]
    tensor = model_input(image)
    raw, proto = forward(channel, "bubble", tensor)
    occupied = np.zeros((h, w), np.uint16)
    bubble_masks = {}
    for owner, (_, raw_mask) in enumerate(
        postprocess(raw, proto, (h, w), tensor.shape[2:]), 1
    ):
        inner = fill.inset_selection(raw_mask)
        inner[occupied > 0] = 0
        if np.any(inner):
            occupied[inner > 0] = owner
            bubble_masks[owner] = inner

    recognized = []
    for record in detect_text(image, channel):
        text = recognize_text(image, record["box"], channel)
        if not text:
            continue
        recognized.append(
            {
                **record,
                "text": text,
                "owner": owner_for_text(record, occupied),
            }
        )
    for index, record in enumerate(recognized, 1):
        record["textBoxId"] = f"t{index:04d}"

    groups = []
    for owner in bubble_masks:
        members = [record for record in recognized if record["owner"] == owner]
        if members:
            groups.append(("bubble", members, bubble_masks[owner]))
    outside = [record for record in recognized if record["owner"] is None]
    for members in group_unframed(outside):
        selection = np.zeros((h, w), np.uint8)
        sizes = []
        for record in members:
            cv2.fillConvexPoly(selection, np.asarray(record["box"], np.int32), 255)
            sizes.append(min(box_metrics(record["coreBox"])[4:]))
        padding = max(4, round(float(np.median(sizes)) * UNFRAMED_PADDING_RATIO))
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (padding * 2 + 1, padding * 2 + 1)
        )
        groups.append(("unframed", members, cv2.dilate(selection, kernel)))
    detected_order = {id(record): index for index, record in enumerate(recognized)}
    groups.sort(
        key=lambda group: min(detected_order[id(record)] for record in group[1])
    )

    page_id = spec["pageId"]
    candidates = []
    preview = image.copy()
    for index, (kind, members, selection) in enumerate(groups, 1):
        group_id = f"r{index:04d}"
        direction = text_direction(members)
        parts = split_bubble(selection, members, direction) if kind == "bubble" else []
        color = (30, 180, 30) if kind == "bubble" else (220, 150, 20)
        for child, (area, lines) in enumerate(parts or [(selection, members)], 1):
            rid = f"{group_id}-{child}" if parts else group_id
            candidate = _text_candidate(rid, group_id, kind, lines)
            x, y, w, h = cv2.boundingRect(area)
            save(root / "areas" / page_id / f"{rid}.png", area[y : y + h, x : x + w])
            candidates.append({**candidate, "area": [x, y, w, h]})
            contours, _ = cv2.findContours(
                area, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            cv2.drawContours(preview, contours, -1, color, 2)
            cv2.putText(preview, rid, (x, max(18, y)), 0, 0.55, color, 2)
            for line in candidate["lines"]:
                cv2.polylines(
                    preview, [np.asarray(line["box"], np.int32)], True, color, 1
                )
    page = {key: value for key, value in spec.items() if key != "source"}
    page["candidates"] = candidates
    scale = min(1.0, SCAN_PREVIEW_EDGE / max(h, w))
    preview_path = save(
        root / "diagnostics" / f"{page_id}.png",
        cv2.resize(preview, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
    )
    return page, dict(
        pageId=page_id,
        relativePath=page["relativePath"],
        preview=preview_path,
        records=[
            {key: candidate[key] for key in ("regionId", "group", "kind", "message")}
            for candidate in candidates
        ],
    )


def scan(args, channel):
    """整批共享 OCR 与气泡分割会话，工作目录留待选字。"""
    root = Path(args["output"])
    results = [scan_page(page, root, channel) for page in args["pages"]]
    (root / "scan.json").write_text(
        json.dumps([page for page, _ in results], ensure_ascii=False), encoding="utf-8"
    )
    return dict(pages=[diagnostics for _, diagnostics in results])


def _box_mask(shape, boxes):
    mask = np.zeros(shape, np.uint8)
    for box in boxes:
        cv2.fillConvexPoly(mask, np.asarray(box, np.int32), 255)
    return mask


def _write_box(area, ink):
    """在可写区域内找能放下的矩形，再选靠近原文的位置。"""
    x, y, w, h = cv2.boundingRect(area)
    if not w:
        raise ValueError("Empty writing area")
    crop = area[y : y + h, x : x + w]
    ix, iy, iw, ih = cv2.boundingRect(ink)
    inset = cv2.erode(
        crop, repair.ellipse(TEXT_MARGIN), borderType=cv2.BORDER_CONSTANT, borderValue=0
    )
    valid = inset if cv2.countNonZero(inset) else crop
    edge = max(w, h)
    low, high = 2, edge
    centers = valid
    width = height = 1
    # 先在整个区域内试放，避免把矩形锁在离原文最近的狭窄边缘。
    while low <= high:
        size = (low + high) // 2
        trial = max(1, w * size // edge), max(1, h * size // edge)
        fits = cv2.erode(
            valid,
            cv2.getStructuringElement(cv2.MORPH_RECT, trial),
            borderType=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        if cv2.countNonZero(fits):
            width, height = trial
            centers = fits
            low = size + 1
        else:
            high = size - 1
    rows, cols = np.nonzero(centers)
    cx, cy = ix + iw // 2 - x, iy + ih // 2 - y
    nearest = np.argmin((cols - cx) ** 2 + (rows - cy) ** 2)
    return [
        x + int(cols[nearest]) - width // 2,
        y + int(rows[nearest]) - height // 2,
        width,
        height,
    ]


def _save_patch(root, page_id, region_id, original, repaired, mask):
    """透明像素由原稿提供。保存局部补丁即可按区域生成消字版。"""
    changed = (mask > 0) & np.any(original != repaired, axis=2)
    x, y, w, h = cv2.boundingRect(changed.astype(np.uint8))
    if not w:
        x, y, _, _ = cv2.boundingRect(mask)
        w, h = 1, 1
    crop = np.s_[y : y + h, x : x + w]
    alpha = changed[crop].astype(np.uint8) * 255
    pixels = repaired[crop].copy()
    pixels[alpha == 0] = 0
    member = f"patches/{page_id}/{region_id}.png"
    save(root / member, np.dstack((pixels, alpha)))
    return dict(path=member, box=[x, y, w, h])


def _read_candidate_area(root, page_id, candidate, shape):
    """恢复整页坐标。重分格使用内存掩码，旧扫描使用裁下的掩码文件。"""
    x, y, w, h = candidate["area"]
    crop = candidate.get("mask")
    if crop is None:
        crop = read_layout_area(
            root / "areas" / page_id / f"{candidate['regionId']}.png", (h, w)
        )
    mask = np.zeros(shape, np.uint8)
    mask[y : y + h, x : x + w] = crop
    return mask


def _prepare_group(
    image,
    candidates,
    available,
    root,
    output,
    page_id,
    occupied,
    expanded,
    writing,
    channel,
    variants,
):
    """同一气泡只消字一次，补丁按格保存。"""
    shape = image.shape[:2]
    selection = np.zeros(shape, np.uint8)
    blocks = []
    bubble = candidates[0]["kind"] == "bubble"
    whole = (
        bubble
        and variants
        and len(candidates) > 1
        and all(candidate["regionId"] in available for candidate in candidates)
    )
    previously_written = writing.copy() if whole else None
    for candidate in candidates:
        rid = candidate["regionId"]
        part_area = _read_candidate_area(root, page_id, candidate, shape)
        selection |= part_area
        pick = available.get(rid)
        if pick is None:
            continue
        index = candidate["index"]
        area = np.where((occupied == 0) | (occupied == index), part_area, 0)
        boxes = [line["box"] for line in candidate["lines"]]
        ink = _box_mask(shape, boxes)
        # 笔画邻域只分给一块，局部重做与本次选字无关。
        local = np.where(
            (occupied == index) | ((occupied == 0) & (expanded == index)), area, 0
        )
        if not np.any(local):
            raise ValueError(f"No writable text pixels in {rid}")
        area[writing] = 0
        box = _write_box(area, ink)
        x, y, w, h = box
        writing[y : y + h, x : x + w] = True
        blocks.append((candidate, pick, box, local, part_area, boxes))
    background, color = _background_color(image, selection, occupied)
    dark_background = (
        cv2.cvtColor(np.uint8([[color[::-1]]]), cv2.COLOR_BGR2GRAY)[0, 0] < 128
    )
    masks = {}
    union = np.zeros(shape, np.uint8)
    fills = []
    for candidate, pick, _, local, part_area, boxes in blocks:
        rid = candidate["regionId"]
        if background["route"] == "fill" and not pick.get("contour"):
            mask = part_area if bubble else local
            fills.append((mask, color))
            masks[rid] = (mask, "fill")
            continue
        try:
            stroke = repair.text_mask(image, local, boxes, light_text=dark_background)
        except ValueError:
            stroke = None
        if pick.get("contour"):
            masks[rid] = (local if stroke is None else stroke, "contour")
        elif stroke is not None:
            masks[rid] = (stroke, "lama")
            union |= stroke

    # 气泡边缘只沿整个内缩掩码混合，分格沿内部切口共享同一份底图。
    if fills and bubble:
        fills = [(selection, color)]
    repaired = fill.render_fill(image, fills) if fills else image.copy()
    if np.any(union):
        try:
            repaired[union > 0] = repair.inpaint(
                image, union, lambda tensor: forward(channel, "inpaint", tensor)[0]
            )
        except ValueError:
            # 这些区域仍可导入，导出时保留原图，供 Agent 按需补做。
            masks = {
                rid: result for rid, result in masks.items() if result[1] != "lama"
            }

    part_records = []
    for candidate, pick, box, _, _, _ in blocks:
        rid = candidate["regionId"]
        background_color = color
        patch = None
        if rid in masks:
            mask, method = masks[rid]
            if method == "contour":
                tone = 0 if dark_background else 255
                repaired[mask > 0] = tone
                background_color = [tone] * 3
            if method != "lama" or not np.array_equal(
                image[mask > 0], repaired[mask > 0]
            ):
                patch = _save_patch(output, page_id, rid, image, repaired, mask)
        region = dict(
            regionId=rid,
            kind=candidate["kind"],
            direction=candidate["direction"],
            backgroundColor=background_color,
            box=box,
            patch=patch,
        )
        record = dict(
            pageId=page_id,
            regionId=rid,
            message=pick.get("message", candidate["message"]),
        )
        part_records.append(record)
        yield region, record

    if whole:
        part_ids = [record["regionId"] for record in part_records]
        signature = hashlib.sha256(",".join(part_ids).encode()).hexdigest()[:12]
        whole_id = f"{candidates[0]['group']}-whole-{signature}"
        lines = [line for candidate in candidates for line in candidate["lines"]]
        ink = _box_mask(shape, [line["box"] for line in lines])
        selection[previously_written] = 0
        box = _write_box(selection, ink)
        x, y, w, h = box
        writing[y : y + h, x : x + w] = True
        yield (
            dict(
                regionId=whole_id,
                kind="bubble",
                direction=text_direction(lines),
                backgroundColor=color,
                box=box,
                patch=None,
                parts=part_ids,
            ),
            dict(
                pageId=page_id,
                regionId=whole_id,
                message="\n".join(record["message"] for record in part_records),
            ),
        )


def _bubble_group(page, group_id):
    """按组取得原 OCR 框，供诊断和重分格共用。"""
    group = [
        candidate for candidate in page["candidates"] if candidate["group"] == group_id
    ]
    if not group or group[0]["kind"] != "bubble":
        raise ValueError(f"Unknown bubble group: {group_id}")
    if any("lines" not in candidate for candidate in group):
        raise ValueError("Bubble correction requires a scan with OCR box IDs")
    return group


def _group_area(root, page, group):
    """重分格沿用整组的原气泡范围。"""
    shape = (page["height"], page["width"])
    area = np.zeros(shape, np.uint8)
    for candidate in group:
        area |= _read_candidate_area(root, page["pageId"], candidate, shape)
    return area


def inspect_bubble_group(args, _channel):
    """只标注指定气泡组，保留整页原图作为参照。"""
    root = Path(args["root"])
    pages = json.loads((root / "scan.json").read_text(encoding="utf-8"))
    page = next((page for page in pages if page["pageId"] == args["pageId"]), None)
    if page is None:
        raise ValueError("Unknown image page")
    group = _bubble_group(page, args["group"])
    image = read_image(root / "normalized" / f"{page['pageId']}.png")
    h, w = image.shape[:2]
    scale = min(1.0, SCAN_PREVIEW_EDGE / max(h, w))
    preview = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    area = _group_area(root, page, group)
    contours, _ = cv2.findContours(area, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(
        preview,
        [np.rint(contour * scale).astype(np.int32) for contour in contours],
        -1,
        (30, 180, 30),
        2,
    )
    lines = []
    for candidate in group:
        for line in candidate["lines"]:
            points = np.rint(np.asarray(line["box"]) * scale).astype(np.int32)
            cv2.polylines(preview, [points], True, (30, 180, 30), 1)
            x, y, _, _ = cv2.boundingRect(points)
            cv2.putText(
                preview,
                line["textBoxId"],
                (x, max(16, y - 2)),
                0,
                0.5,
                (30, 180, 30),
                1,
            )
            lines.append({"textBoxId": line["textBoxId"], "message": line["text"]})
    return {"preview": save(Path(args["output"]), preview), "lines": lines}


def _repartition_group(root, page, group, correction):
    """用分配后的 OCR 框划分原气泡，并生成本次选字结果。"""
    group_id = correction["group"]
    known = {
        line["textBoxId"]: line for candidate in group for line in candidate["lines"]
    }
    partitions = correction["parts"]
    submitted = [key for part in partitions for key in part["textBoxIds"]]
    if len(set(submitted)) != len(submitted) or set(submitted) != known.keys():
        raise ValueError("Assign every OCR box in the bubble group to exactly one part")

    area = _group_area(root, page, group)
    x, y, w, h = cv2.boundingRect(area)
    cropped = area[y : y + h, x : x + w]
    supported = np.zeros(cropped.shape, bool)
    distances = np.full(cropped.shape, np.inf, np.float32)
    owners = np.zeros(cropped.shape, np.int32)
    lines_by_part = []
    for i, part in enumerate(partitions, 1):
        lines = [known[key] for key in part["textBoxIds"]]
        # 已确认的原字框作切分种子。重叠字框无法安全分给不同格。
        seeds = _box_mask(
            cropped.shape, [np.asarray(line["coreBox"]) - [x, y] for line in lines]
        )
        seed = (seeds != 0) & (cropped != 0)
        if not np.any(seed) or np.any(seed & supported):
            raise ValueError("OCR boxes overlap or fall outside the bubble")
        supported |= seed
        distance = cv2.distanceTransform(
            (~seed).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
        )
        nearer = (distance < distances) & (cropped != 0)
        owners[nearer] = i
        distances[nearer] = distance[nearer]
        lines_by_part.append(lines)

    before = {
        frozenset(line["textBoxId"] for line in candidate["lines"]): candidate[
            "regionId"
        ]
        for candidate in group
    }
    corrected = []
    selected = {}
    for i, (part, lines) in enumerate(zip(partitions, lines_by_part), 1):
        identity = frozenset(part["textBoxIds"])
        digest = hashlib.sha256(",".join(sorted(identity)).encode()).hexdigest()[:12]
        rid = before.get(identity, f"{group_id}-qa-{digest}")
        candidate = _text_candidate(rid, group_id, "bubble", lines)
        corrected.append(
            {
                **candidate,
                "area": [x, y, w, h],
                "mask": (owners == i).astype(np.uint8) * 255,
            }
        )
        if part["translate"]:
            selected[rid] = {"pageId": page["pageId"], "regionId": rid}
    return corrected, selected


def prepare(args, channel):
    """把选字与重分格结果转成可封包的条目和消字补丁。"""
    root, output = Path(args["root"]), Path(args["output"])
    pages = json.loads((root / "scan.json").read_text(encoding="utf-8"))
    by_page = {}
    for pick in args["selected"]:
        selected = by_page.setdefault(pick["pageId"], {})
        region_id = pick["regionId"]
        if region_id in selected:
            raise ValueError(f"Duplicate selected region: {region_id}")
        selected[region_id] = pick
    records = []
    target = args.get("repartition")
    for page in pages:
        page_id = page["pageId"]
        selected = by_page.pop(page_id, {})
        repairing = target is not None and target["pageId"] == page_id
        if selected or repairing:
            for correction in args.get("partitions", []):
                if correction["pageId"] != page_id:
                    continue
                group_id = correction["group"]
                old = _bubble_group(page, group_id)
                corrected, new_picks = _repartition_group(root, page, old, correction)
                start = page["candidates"].index(old[0])
                page["candidates"][start : start + len(old)] = corrected
                if repairing and group_id == target["group"]:
                    selected = new_picks
        candidates = page.pop("candidates")
        if not selected.keys() <= {candidate["regionId"] for candidate in candidates}:
            raise ValueError(f"Unknown selected region on {page_id}")
        page["regions"] = []
        if not selected:
            continue
        original = read_image(root / "normalized" / f"{page_id}.png")
        shape = original.shape[:2]
        occupied = np.zeros(shape, np.float32)
        for index, candidate in enumerate(candidates, 1):
            candidate["index"] = index
            for line in candidate["lines"]:
                cv2.fillConvexPoly(occupied, np.asarray(line["box"], np.int32), index)
        expanded = cv2.dilate(occupied, repair.ellipse(TEXT_MARGIN))
        writing = np.zeros(shape, bool)
        if repairing:
            for x, y, w, h in args["reserved"]:
                writing[y : y + h, x : x + w] = True
        for _, group in groupby(candidates, key=lambda candidate: candidate["group"]):
            group = list(group)
            if any(candidate["regionId"] in selected for candidate in group):
                for region, record in _prepare_group(
                    original,
                    group,
                    selected,
                    root,
                    output,
                    page_id,
                    occupied,
                    expanded,
                    writing,
                    channel,
                    args.get("variants", True),
                ):
                    page["regions"].append(region)
                    records.append(record)
    if by_page:
        raise ValueError("Unknown selected image page")
    return dict(pages=pages, records=records)


PARTITION_RULES = dict(
    max_candidates=6,
    max_blocks=4,
    min_area_ratio=0.12,
    contour_epsilon=0.004,
    minimum_depth=1.5,
    depth_ratio=0.035,
    max_valleys=8,
    minimum_cut=2,
    core_minimum=3,
    maximum_cut_ratio=0.96,
    text_coverage=0.9,
    width_quantiles=(0.05, 0.95),
    core_ratios=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8),
)


def partition_candidates(mask):
    """从轮廓凹点与距离场核心生成二分候选。"""
    mask = mask.astype(bool)
    area = int(np.count_nonzero(mask))
    h, w = mask.shape
    yy, xx = np.indices(mask.shape)
    distance = cv2.distanceTransform(
        np.pad(mask.astype("uint8"), 1), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
    )[1:-1, 1:-1]
    proposals = []

    def add(part):
        """排除碎片，用低成本的相对切口宽度给候选排序。"""
        a = part & mask
        b = ~part & mask
        left_area = np.count_nonzero(a)
        smaller_area = min(left_area, area - left_area)
        if smaller_area < area * PARTITION_RULES["min_area_ratio"]:
            return
        if any(cv2.connectedComponents(x.astype("uint8"))[0] != 2 for x in (a, b)):
            return
        edge = cv2.dilate(a.astype("uint8"), np.ones((3, 3), np.uint8)).astype(bool) & b
        score = np.count_nonzero(edge) / math.sqrt(smaller_area)
        proposals.append((score, a))

    contours, _ = cv2.findContours(
        mask.astype("uint8"), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    contour = cv2.approxPolyDP(
        contour, PARTITION_RULES["contour_epsilon"] * cv2.arcLength(contour, True), True
    )
    hull = cv2.convexHull(contour, returnPoints=False)
    defects = None
    if len(contour) > 3 and len(hull) > 2:
        # 自交轮廓的凸包顺序不收敛时，仍可用下方的距离场候选。
        indices = hull.ravel()
        steps = np.diff(indices, append=indices[0])
        if min(np.count_nonzero(steps < 0), np.count_nonzero(steps > 0)) == 1:
            defects = cv2.convexityDefects(contour, np.sort(hull, axis=0))
    valleys = []
    if defects is not None:
        for _, _, far, depth in defects.reshape(-1, 4):
            if depth / 256 >= max(
                PARTITION_RULES["minimum_depth"],
                min(w, h) * PARTITION_RULES["depth_ratio"],
            ):
                valleys.append((depth, contour.reshape(-1, 2)[far]))
    valleys = sorted(valleys, key=lambda x: (-x[0], int(x[1][0]), int(x[1][1])))[
        : PARTITION_RULES["max_valleys"]
    ]
    for i, (_, p) in enumerate(valleys):
        for _, q in valleys[i + 1 :]:
            v = q - p
            if np.linalg.norm(v) < PARTITION_RULES["minimum_cut"]:
                continue
            add(
                (xx - p[0]) * v[1] - (yy - p[1]) * v[0] >= 0,
            )

    deepest = distance.max()
    for ratio in PARTITION_RULES["core_ratios"]:
        n, labels, stats, _ = cv2.connectedComponentsWithStats(
            (distance > deepest * ratio).astype("uint8")
        )
        ids = sorted(range(1, n), key=lambda i: -stats[i, 4])
        ids = (
            [
                i
                for i in ids
                if stats[i, 4]
                >= max(
                    PARTITION_RULES["core_minimum"],
                    stats[ids[0], 4] * PARTITION_RULES["min_area_ratio"],
                )
            ]
            if ids
            else []
        )
        if not 2 <= len(ids) <= PARTITION_RULES["max_blocks"]:
            continue
        fields = [
            cv2.distanceTransform(
                (labels != i).astype("uint8"), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
            )
            for i in ids
        ]
        nearest = np.argmin(np.stack(fields), axis=0)
        for index in range(len(ids)):
            add(nearest == index)
    proposals.sort(key=lambda proposal: proposal[0])
    return [part for _, part in proposals[: PARTITION_RULES["max_candidates"]]]


def _cut_width(left, right):
    """切口投影除以同向较窄主体的投影，忽略尾巴和孤立的边缘像素。"""
    edge = cv2.dilate(left.astype(np.uint8), np.ones((3, 3), np.uint8))
    interface = np.column_stack(np.nonzero((edge != 0) & right))
    if len(interface) < 2:
        return 0.0
    _, _, axes = np.linalg.svd(interface - interface.mean(axis=0), full_matrices=False)
    tangent = axes[0]

    def width(points):
        """投影的内部分位区间忽略尾巴对宽度的影响。"""
        return np.ptp(np.quantile(points @ tangent, PARTITION_RULES["width_quantiles"]))

    return float(
        width(interface)
        / max(
            1, min(width(np.column_stack(np.nonzero(part))) for part in (left, right))
        )
    )


def _partition_groups(parts, supports, members):
    """每格都要有文字，跨过格界的 OCR 框须有明确归属。"""
    groups = [[] for _ in parts]
    for support, member in zip(supports, members):
        areas = [np.count_nonzero(part & support) for part in parts]
        total = sum(areas)
        owner = int(np.argmax(areas))
        if not total or areas[owner] < total * PARTITION_RULES["text_coverage"]:
            return None
        groups[owner].append(member)
    return groups if all(groups) else None


def split_bubble(selection, members, direction):
    """先确认格与文字归属，再按整格的空间关系确定阅读顺序。"""
    if len(members) < 2:
        return []
    x, y, w, h = cv2.boundingRect(selection)
    mask = selection[y : y + h, x : x + w] != 0
    supports = []
    for member in members:
        support = np.zeros(mask.shape, np.uint8)
        points = np.asarray(member["coreBox"], np.int32) - [x, y]
        cv2.fillConvexPoly(support, points.astype(np.int32), 1)
        supports.append(support != 0)

    choices = [[mask]]
    seen = set()
    best, best_key = None, None
    for parts in choices:
        if len(parts) >= PARTITION_RULES["max_blocks"]:
            continue
        for i, part in enumerate(parts):
            for left in partition_candidates(part):
                proposed = [*parts[:i], left, part & ~left, *parts[i + 1 :]]
                groups = _partition_groups(proposed, supports, members)
                if groups is None:
                    continue
                cut = max(
                    _cut_width(a, b)
                    for j, a in enumerate(proposed)
                    for b in proposed[j + 1 :]
                )
                if cut > PARTITION_RULES["maximum_cut_ratio"]:
                    continue
                key = (-len(proposed), cut)
                if best_key is None or key < best_key:
                    best, best_key = (proposed, groups), key

                # 仅展开新的文字归属，减少相同分格的递归搜索。
                identity = tuple(
                    sorted(
                        tuple(record["textBoxId"] for record in group)
                        for group in groups
                    )
                )
                if (
                    identity not in seen
                    and len(choices) <= PARTITION_RULES["max_candidates"]
                ):
                    seen.add(identity)
                    choices.append(proposed)
    if best is None:
        return []

    parts, groups = best
    # 并列格沿横向阅读，上下格按纵向排列。用正文范围而非气泡尾巴估计两轴分隔。
    bounds = np.asarray(
        [
            cv2.boundingRect(
                np.concatenate(
                    [np.asarray(record["coreBox"], np.int32) for record in group]
                )
            )
            for group in groups
        ]
    )
    centers = bounds[:, :2] + bounds[:, 2:] / 2
    separation = np.ptp(centers, axis=0) / np.mean(bounds[:, 2:], axis=0)
    axis = int(np.argmax(separation))
    order = centers[:, axis] * (-1 if axis == 0 and direction == "vertical-rl" else 1)
    if len(set(order)) != len(groups):
        return []
    output = []
    for index in np.argsort(order):
        area = np.zeros_like(selection)
        area[y : y + h, x : x + w] = parts[index].astype(np.uint8) * 255
        output.append((area, groups[index]))
    return output


def _apply_overlay(result, overlay, box):
    """按字层或补丁的透明度合成，保留完全透明处的底图像素。"""
    x, y, w, h = box
    if (
        overlay is None
        or overlay.dtype != np.uint8
        or overlay.shape != (h, w, 4)
        or min(x, y) < 0
        or x + w > result.shape[1]
        or y + h > result.shape[0]
    ):
        raise ValueError("Invalid image overlay")
    destination = result[y : y + h, x : x + w]
    covered = overlay[:, :, 3] > 0
    alpha = overlay[covered, 3:4].astype(np.float64) / 255
    destination[covered] = np.floor(
        overlay[covered, :3] * alpha + destination[covered] * (1 - alpha) + 0.5
    ).astype(np.uint8)


def _compose_text(result, layers_path, root):
    """先应用全部消字补丁，再叠字层，避免补丁盖住相邻译文。"""
    with open(layers_path, encoding="utf-8") as file:
        layers = json.load(file)
    for layer in layers:
        patch = layer["patch"]
        pixels = cv2.imdecode(
            np.fromfile(str(root / patch["path"]), dtype=np.uint8), cv2.IMREAD_UNCHANGED
        )
        _apply_overlay(result, pixels, patch["box"])
    for layer in layers:
        if paint := layer.get("overlay"):
            raw = np.frombuffer(base64.b64decode(paint["png"], validate=True), np.uint8)
            _apply_overlay(
                result, cv2.imdecode(raw, cv2.IMREAD_UNCHANGED), paint["box"]
            )


def _qa_preview(original, translated, qa):
    """等比例并排原图与译图，仅在译图标记异常区域。"""
    height, width = original.shape[:2]
    scale = min(1, qa["maxEdge"] / max(2 * width, height))
    size = (max(1, int(width * scale)), max(1, int(height * scale)))
    if scale < 1:
        translated = cv2.resize(translated, size, interpolation=cv2.INTER_AREA)
        original = cv2.resize(original, size, interpolation=cv2.INTER_AREA)
    elif translated is original and qa["marks"]:
        translated = original.copy()  # 无合成层时，标记仍只画在右侧。
    for mark in qa["marks"]:
        color = (0, 220, 255) if mark["warning"] else (0, 0, 230)
        x, y, w, h = mark["box"]
        end = (round((x + w - 1) * scale), round((y + h - 1) * scale))
        cv2.rectangle(
            translated, (round(x * scale), round(y * scale)), end, color, 3, cv2.LINE_AA
        )
        origin = (round(x * scale), max(18, round(y * scale)))
        cv2.putText(translated, mark["regionId"], origin, 0, 0.55, color, 2)
    return np.concatenate((original, translated), axis=1)


def text_output(args, _channel):
    """每页只合成一次，QA 右侧使用实际写出的译图。"""
    root = Path(args["root"])
    original = read_image(args["original"])
    layers, output, qa = args.get("layers"), args.get("output"), args["qa"]
    translated = original
    if layers is not None:
        translated = original.copy()
        _compose_text(translated, layers, root)
    if output is not None:
        # 写出的 JPEG 已旋正，QA 读回编码后的像素。
        extension = Path(output).suffix.lower()
        if extension not in (".png", ".jpg", ".jpeg"):
            raise ValueError("Unsupported image output format")
        if extension == ".png":
            save(output, translated)
        else:
            save(output, translated, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 95])
            translated = read_image(output)
    save(
        qa["path"],
        _qa_preview(original, translated, qa),
        ".webp",
        [cv2.IMWRITE_WEBP_QUALITY, QA_WEBP_QUALITY],
    )


COMMANDS = {
    "scan": scan,
    "inspect_bubble_group": inspect_bubble_group,
    "prepare": prepare,
    "text_output": text_output,
}

if __name__ == "__main__":
    channel = Channel()
    reader = None
    try:
        header, payload = channel.read()
        args = json.loads(payload)
        reader = threading.Thread(target=channel.listen)
        reader.start()
        result = COMMANDS[header["command"]](args, channel)
        channel.write({"result": True}, json.dumps(result, ensure_ascii=False).encode())
        reader.join()
    except BaseException as error:
        traceback.print_exc(file=sys.stderr)
        channel.write({"error": str(error)})
        sys.exit(1)
