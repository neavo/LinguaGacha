"""区域检测、自动消字、文字分区与离线归档。推理由宿主 Worker 执行。"""

import base64
import json
import math
import sys
import threading
import traceback
from pathlib import Path

import cv2
import numpy as np
from lg.image import fill, repair
from lg.inference import ocr
from lg.inference.channel import Channel

cv2.setNumThreads(1)
IMAGE_SIZE, MODEL_STRIDE = 1600, 32
CONF, IOU, MAX_DET, MAX_NMS = 0.25, 0.7, 300, 30000
UNFRAMED_PADDING_RATIO = 0.5
SOURCE_LINE_MIN_ANGLE = 3
SOURCE_LINE_ANGLE_SPREAD = 5
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


def _erase_group(image, clean, selection, kind, members, background, color, channel):
    """同一气泡共用一次消字，避免沿格界分别修补留下接缝。"""
    boxes = [member["box"] for member in members]
    if background["route"] == "fill":
        mask = selection if kind == "bubble" else _box_mask(selection, boxes)
        if np.any(mask):
            return fill.render_fill(clean, [(mask, color)]), mask, None
    try:
        mask = repair.text_mask(image, selection, boxes)
        repaired = repair.inpaint(
            image, mask, lambda tensor: forward(channel, "inpaint", tensor)[0]
        )
    except ValueError as error:
        return clean, None, str(error)
    clean[mask > 0] = repaired
    return clean, mask, None


def create_page(spec, root, channel):
    """单页完成气泡分割、OCR、自动分区、消字和诊断预览。"""
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
    text_boxes = []
    for index, record in enumerate(recognized, 1):
        record["textBoxId"] = f"t{index:04d}"
        text_boxes.append(
            dict(
                textBoxId=record["textBoxId"],
                box=np.asarray(record["box"]).tolist(),
                coreBox=np.asarray(record["coreBox"]).tolist(),
                text=record["text"],
            )
        )

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

    text_mask = np.zeros((h, w), np.uint8)
    for record in recognized:
        cv2.fillConvexPoly(text_mask, np.asarray(record["box"], np.int32), 255)
    page_id = spec["pageId"]
    regions, records, clean_regions, failures = [], [], [], []
    clean = image.copy()
    preview = image.copy()
    for index, (kind, members, selection) in enumerate(groups, 1):
        region_id = f"r{index:04d}"  # 拆格不影响后续区域的译文继承身份。
        direction = text_direction(members)
        background, color = _background_color(image, selection, text_mask)
        parts = split_bubble(selection, members, direction) if kind == "bubble" else []
        clean, erased, failure = _erase_group(
            image, clean, selection, kind, members, background, color, channel
        )
        preview_color = (30, 180, 30) if kind == "bubble" else (220, 150, 20)
        for child, (area, lines) in enumerate(parts or [(selection, members)], 1):
            rid = f"{region_id}-{child}" if parts else region_id
            writing = text_direction(lines) if parts else direction
            message = ordered_text(lines, writing)
            member = f"layout-areas/{page_id}/{rid}.png"
            save(root / member, area)
            region = dict(
                regionId=rid,
                kind=kind,
                textBoxIds=[line["textBoxId"] for line in lines],
                layoutArea=dict(path=member),
                direction=writing,
                backgroundColor=color,
            )
            regions.append(region)
            records.append(dict(pageId=page_id, regionId=rid, message=message))
            # 只记录本格实际擦除的像素，供导出时逐格回退。
            child_mask = erased
            if parts and erased is not None:
                child_mask = erased & area
                if not np.any(child_mask):
                    child_mask = None
            if child_mask is not None:
                erase_member = f"erase-masks/{page_id}/{rid}.png"
                save(root / erase_member, child_mask)
                clean_regions.append(
                    dict(regionId=rid, status="cleaned", eraseMask=erase_member)
                )
            else:
                failures.append(
                    dict(regionId=rid, error=failure or "Empty erase mask in region")
                )
                clean_regions.append(dict(regionId=rid, status="failed"))
            contours, _ = cv2.findContours(
                area, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            cv2.drawContours(preview, contours, -1, preview_color, 2)
            x, y, _, _ = cv2.boundingRect(area)
            cv2.putText(preview, rid, (x, max(18, y)), 0, 0.55, preview_color, 2)
            for line in lines:
                cv2.polylines(
                    preview, [np.asarray(line["box"], np.int32)], True, preview_color, 1
                )
    page = {
        key: spec[key]
        for key in (
            "pageId",
            "relativePath",
            "original",
            "sha256",
            "width",
            "height",
            "orientation",
        )
    }
    page.update(textBoxes=text_boxes, regions=regions)
    clean_member = f"clean/{page_id}.png"
    save(root / clean_member, clean)
    scale = min(1.0, 1600 / max(h, w))
    preview_file = save(
        root / "diagnostics" / f"{page_id}.png",
        cv2.resize(preview, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
    )
    return dict(
        page=page,
        records=records,
        clean=dict(pageId=page_id, clean=clean_member, regions=clean_regions),
        diagnostics=dict(
            preview=preview_file,
            detected=len(text_boxes),
            regions=len(regions),
            failures=failures,
        ),
    )


def create(args, channel):
    """整册共用一次 helper 与推理 Worker，模型会话跨页复用。"""
    root = Path(args["output"])
    return dict(pages=[create_page(page, root, channel) for page in args["pages"]])


def _box_mask(layout_area, boxes):
    """无框填色只覆盖 OCR 框附近，保留外围用于排版的空间。"""
    mask = np.zeros_like(layout_area)
    for box in boxes:
        cv2.fillConvexPoly(mask, np.asarray(box, np.int32), 255)
    if np.any(mask):
        mask = cv2.dilate(mask, repair.ellipse(2)) & layout_area
    return mask


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


def _line_alignment(lines, width, height, direction):
    """在倾斜原行带的局部坐标系里求解，再把字形变换回原图。"""
    if direction != "horizontal-tb" or len(lines) < 3:
        return None
    axes = np.asarray([line[1] - line[0] + line[2] - line[3] for line in lines])
    angles = np.degrees(np.arctan2(axes[:, 1], axes[:, 0]))
    angle = float(np.median(angles))
    if (
        abs(angle) < SOURCE_LINE_MIN_ANGLE
        or np.max(np.abs(angles - angle)) > SOURCE_LINE_ANGLE_SPREAD
    ):
        return None
    transform = cv2.getRotationMatrix2D((0.0, 0.0), angle, 1.0)
    corners = (
        np.asarray([[0, 0], [width, 0], [width, height], [0, height]])
        @ transform[:, :2].T
    )
    low = np.floor(corners.min(axis=0))
    size = tuple((np.ceil(corners.max(axis=0)) - low).astype(int).tolist())
    transform[:, 2] = -low
    return transform, size


def _distance_field(mask):
    """补零边后测量到区域外的距离，输出 Chromium 读取的 Float32 字节。"""
    distance = cv2.distanceTransform(
        np.pad(mask.astype(np.uint8), 1), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
    )[1:-1, 1:-1]
    return base64.b64encode(distance.astype("<f4").tobytes()).decode("ascii")


def text_layout(args, _channel):
    """只为准备阶段已确定的区域生成距离场与原行带。"""
    page = args["page"]
    boxes = {box["textBoxId"]: box["coreBox"] for box in page["textBoxes"]}
    output, budget = [], 0
    for region in page["regions"]:
        mask = read_layout_area(
            Path(args["root"]) / region["layoutArea"]["path"],
            (page["height"], page["width"]),
        )
        x, y, w, h = cv2.boundingRect(mask)
        crop = mask[y : y + h, x : x + w]
        geometry = dict(regionId=region["regionId"], box=[x, y, w, h])
        lines, alignment = [], None
        if region["kind"] == "unframed":
            lines = [
                np.asarray(boxes[text_box_id], np.float64) - [x, y]
                for text_box_id in region["textBoxIds"]
            ]
            alignment = _line_alignment(lines, w, h, region["direction"])
        budget += w * h * 4
        if alignment is not None:
            transform, size = alignment
            budget += math.prod(size) * 4
        if budget > args["maximumBytes"]:
            raise ValueError(
                f"Image text material budget exceeded: {region['regionId']}"
            )
        geometry["distance"] = _distance_field(crop)
        if alignment is not None:
            aligned = cv2.warpAffine(crop, transform, size, flags=cv2.INTER_NEAREST)
            inverse = cv2.invertAffineTransform(transform)
            geometry["alignment"] = dict(
                size=size,
                distance=_distance_field(aligned),
                transform=inverse.T.reshape(-1).tolist(),  # CSS matrix 按列接收系数。
            )
            lines = [line @ transform[:, :2].T + transform[:, 2] for line in lines]
        geometry["sourceLines"] = [line.tolist() for line in lines]
        output.append(geometry)
    return output


def _compose_text(result, composition, root):
    """按区域顺序叠加消字与译文像素，原图提供其余像素。"""
    clean = read_image(composition["clean"])
    if clean.shape != result.shape:
        raise ValueError("Text base dimensions mismatch")
    with open(composition["layers"], encoding="utf-8") as file:
        layers = json.load(file)
    for layer in layers:
        mask = cv2.imdecode(
            np.fromfile(str(root / layer["eraseMask"]), dtype=np.uint8),
            cv2.IMREAD_GRAYSCALE,
        )
        if mask is None or mask.shape != clean.shape[:2]:
            raise ValueError("Invalid erase mask")
        changed = mask > 0
        result[changed] = clean[changed]
        paint = layer.get("overlay")
        if paint is not None:
            x, y, w, h = paint["box"]
            raw = np.frombuffer(base64.b64decode(paint["png"], validate=True), np.uint8)
            overlay = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
            if (
                overlay is None
                or overlay.dtype != np.uint8
                or overlay.shape != (h, w, 4)
            ):
                raise ValueError("Invalid text overlay")
            covered = overlay[:, :, 3] > 0
            alpha = overlay[:, :, 3:4].astype(np.float64) / 255
            destination = result[y : y + h, x : x + w]
            composite = np.floor(
                overlay[:, :, :3] * alpha + destination * (1 - alpha) + 0.5
            ).astype(np.uint8)
            destination[covered] = composite[covered]


def _qa_preview(original, translated, qa, root):
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
        # 黄色待译，红色消字或排版失败。
        color = (0, 220, 255) if mark["incomplete"] else (0, 0, 230)
        mask = read_layout_area(root / mark["layoutArea"], (height, width))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        x, y, _, _ = cv2.boundingRect(mask)
        # 在预览尺寸绘制标记，保留大图缩小后的区域编号可读性。
        if scale < 1:
            contours = [
                np.rint(contour * scale).astype(np.int32) for contour in contours
            ]
        cv2.drawContours(translated, contours, -1, color, 3, cv2.LINE_AA)
        origin = (round(x * scale), max(18, round(y * scale)))
        cv2.putText(translated, mark["regionId"], origin, 0, 0.55, color, 2)
    return np.concatenate((original, translated), axis=1)


def text_output(args, _channel):
    """合成后直接编码，正式输出和 QA 共用同一页译图像素。"""
    root = Path(args["root"])
    original = read_image(args["original"])
    composition, qa = args.get("composition"), args.get("qa")
    translated = original
    if composition is not None:
        translated = original.copy() if qa is not None else original
        _compose_text(translated, composition, root)
    output = args["output"]
    if qa is not None:
        return dict(
            path=save(
                output,
                _qa_preview(original, translated, qa, root),
                ".webp",
                [cv2.IMWRITE_WEBP_QUALITY, QA_WEBP_QUALITY],
            )
        )
    # JPEG 写出已旋正的像素，避免携带原稿方向元数据。
    extension = Path(output).suffix.lower()
    if extension not in (".png", ".jpg", ".jpeg"):
        raise ValueError("Unsupported image output format")
    parameters = [cv2.IMWRITE_JPEG_QUALITY, 95] if extension != ".png" else []
    return dict(
        path=save(
            output,
            translated,
            ".jpg" if extension == ".jpeg" else extension,
            parameters,
        )
    )


COMMANDS = {
    "create": create,
    "text_layout": text_layout,
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
