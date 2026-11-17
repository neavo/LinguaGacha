"""区域检测、自动消字、文字分区与离线归档。推理由宿主 Worker 执行。"""

import base64
import json
import math
import sys
import threading
import traceback
import zipfile
from pathlib import Path

import cv2
import numpy as np
from lg.image import fill, repair
from lg.inference import text_detection
from lg.inference.channel import Channel

cv2.setNumThreads(1)
IMAGE_SIZE, MODEL_STRIDE = 1600, 32
CONF, IOU, MAX_DET, MAX_NMS = 0.25, 0.7, 300, 30000
TEXT_SIDE = 1280
RECOGNITION_HEIGHT = 48
UNFRAMED_PADDING_RATIO = 0.5
MANGA_TEXT_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
MANGA_TEXT_STD = np.array([0.229, 0.224, 0.225], np.float32)
MANGA_TEXT_THRESHOLD = 0.15
MANGA_TEXT_BOX_THRESHOLD = 0.25
MANGA_TEXT_UNCLIP = 1.4


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


def save(file, image):
    """PNG 编码成功后写出磁盘并返回解析路径。"""
    Path(file).parent.mkdir(parents=True, exist_ok=True)
    ok, data = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("PNG encoding failed")
    data.tofile(str(file))
    return str(Path(file).resolve())


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


def manga_text_input(image):
    """按页面比例控制 PP-OCRv6-Manga 像素预算并执行 ImageNet 归一化。"""
    height, width = image.shape[:2]
    if max(height, width) / min(height, width) > 2:
        ratio = min(1.0, math.sqrt(0.75 * TEXT_SIDE * TEXT_SIDE / (height * width)))
    else:
        ratio = TEXT_SIDE / max(height, width)
    target_h = max(32, int(round(height * ratio / 32) * 32))
    target_w = max(32, int(round(width * ratio / 32) * 32))
    resized = cv2.resize(image, (target_w, target_h)).astype(np.float32) / 255
    normalized = (resized - MANGA_TEXT_MEAN) / MANGA_TEXT_STD
    return np.ascontiguousarray(normalized.transpose(2, 0, 1)[None])


def detect_text(image, channel):
    """整页等比缩放到 1280 像素预算后检测一次。"""
    tensor = manga_text_input(image)
    (probability,) = forward(channel, "text", tensor)
    return text_detection.det_box_records(
        probability,
        *image.shape[:2],
        round_coords=True,
        threshold=MANGA_TEXT_THRESHOLD,
        box_threshold=MANGA_TEXT_BOX_THRESHOLD,
        unclip_ratio=MANGA_TEXT_UNCLIP,
    )


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
    height, width = crop.shape[:2]
    target_width = max(16, round(RECOGNITION_HEIGHT * width / max(1, height)))
    resized = cv2.resize(crop, (target_width, RECOGNITION_HEIGHT)).astype(np.float32)
    tensor = np.ascontiguousarray(
        ((resized / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None]
    )
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
    background, color = fill.analyze_background(image, selection, text_mask)
    if color is None:
        pixels = image[selection > 0]
        if not len(pixels):
            raise ValueError("Empty region selection")
        color = np.median(pixels, axis=0).round().astype(np.uint8)[::-1].tolist()
    return background, color


def _clean_page(image, page, root, backgrounds, channel):
    """填色优先，其他区域只尝试一次笔画掩码 LaMa，失败保留原图。"""
    result = image.copy()
    h, w = image.shape[:2]
    boxes = {box["textBoxId"]: box["box"] for box in page["textBoxes"]}
    clean_regions, diagnostics = [], []
    for region in page["regions"]:
        rid = region["regionId"]
        layout_area = read_layout_area(root / region["layoutArea"]["path"], (h, w))
        relevant = [boxes[text_box_id] for text_box_id in region["textBoxIds"]]
        mask, cleaned = None, False
        if backgrounds[rid]["route"] == "fill":
            mask = (
                layout_area
                if region["kind"] == "bubble"
                else _box_mask((h, w), layout_area, relevant)
            )
            if np.any(mask):
                result = fill.render_fill(result, [(mask, region["backgroundColor"])])
                cleaned = True
        if not cleaned:
            try:
                mask = repair.text_mask(image, layout_area, relevant)
                repaired = repair.inpaint(
                    image,
                    mask,
                    lambda tensor: forward(channel, "inpaint", tensor)[0],
                )
                result[mask > 0] = repaired
                cleaned = True
            except ValueError as error:
                diagnostics.append(dict(regionId=rid, error=str(error)))
        if not cleaned:
            clean_regions.append(dict(regionId=rid, status="failed"))
            continue
        member = f"erase-masks/{page['pageId']}/{rid}.png"
        save(root / member, mask)
        clean_regions.append(
            dict(
                regionId=rid,
                status="cleaned",
                eraseMask=member,
            )
        )
    clean_member = f"clean/{page['pageId']}.png"
    save(root / clean_member, result)
    return (
        dict(
            pageId=page["pageId"],
            clean=clean_member,
            regions=clean_regions,
        ),
        diagnostics,
    )


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
    regions, records, backgrounds = [], [], {}
    for index, (kind, members, selection) in enumerate(groups, 1):
        region_id = f"r{index:04d}"
        direction = text_direction(members)
        message = ordered_text(members, direction)
        member = f"layout-areas/{spec['pageId']}/{region_id}.png"
        save(root / member, selection)
        background, color = _background_color(image, selection, text_mask)
        backgrounds[region_id] = background
        regions.append(
            dict(
                regionId=region_id,
                kind=kind,
                textBoxIds=[record["textBoxId"] for record in members],
                layoutArea=dict(path=member),
                direction=direction,
                backgroundColor=color,
            )
        )
        records.append(dict(pageId=spec["pageId"], regionId=region_id, message=message))
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
    clean, diagnostics = _clean_page(image, page, root, backgrounds, channel)

    preview = image.copy()
    for region in regions:
        color = (30, 180, 30) if region["kind"] == "bubble" else (220, 150, 20)
        for text_box_id in region["textBoxIds"]:
            text_box = next(
                box for box in text_boxes if box["textBoxId"] == text_box_id
            )
            cv2.polylines(
                preview, [np.asarray(text_box["box"], np.int32)], True, color, 2
            )
    scale = min(1.0, 1600 / max(h, w))
    preview_file = save(
        root / "diagnostics" / f"{spec['pageId']}.png",
        cv2.resize(preview, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
    )
    return dict(
        page=page,
        records=records,
        clean=clean,
        diagnostics=dict(
            preview=preview_file,
            detected=len(text_boxes),
            regions=len(regions),
            failures=diagnostics,
        ),
    )


def create(args, channel):
    """整册共用一次 helper 与推理 Worker，模型会话跨页复用。"""
    root = Path(args["output"])
    return dict(pages=[create_page(page, root, channel) for page in args["pages"]])


def _box_mask(shape, layout_area, boxes):
    """扩展文字框并裁到区域内，供无框填色和 LaMa 共用。"""
    mask = np.zeros(shape, np.uint8)
    for box in boxes:
        cv2.fillConvexPoly(mask, np.asarray(box, np.int32), 255)
    if np.any(mask):
        mask = cv2.dilate(mask, repair.ellipse(2)) & layout_area
    return mask


def pack(args, _channel):
    """按 SDK 已验证的成员清单流式归档。"""
    with zipfile.ZipFile(args["output"], "x", allowZip64=False) as archive:
        for member, value in (
            ("image.json", args["book"]),
            ("items.json", args["records"]),
            ("clean.json", args["clean"]),
        ):
            archive.writestr(
                member,
                json.dumps(value, ensure_ascii=False),
                compress_type=zipfile.ZIP_DEFLATED,
            )
        for member, source in args["sources"].items():
            archive.write(source, member, compress_type=zipfile.ZIP_STORED)
    return dict(path=args["output"])


PARTITION_RULES = dict(
    max_candidates=6,
    min_area_ratio=0.12,
    contour_epsilon=0.004,
    minimum_depth=1.5,
    depth_ratio=0.035,
    max_valleys=8,
    minimum_cut=2,
    core_minimum=3,
    duplicate_ratio=0.06,
    core_ratios=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8),
)


def partition_candidates(mask):
    """只读掩码生成二分候选。不读取样本身份、人工种子或文字切分。"""
    mask = mask.astype("uint8")
    area = int(mask.sum())
    h, w = mask.shape
    yy, xx = np.indices(mask.shape)
    distance = cv2.distanceTransform(
        np.pad(mask, 1), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
    )[1:-1, 1:-1]
    proposals = []

    def add(part):
        """只保留两个连通主体，并按连接宽度排序。"""
        a = part & (mask > 0)
        b = ~part & (mask > 0)
        if min(a.sum(), b.sum()) < area * PARTITION_RULES["min_area_ratio"]:
            return
        if any(cv2.connectedComponents(x.astype("uint8"))[0] != 2 for x in (a, b)):
            return
        # 候选切口按较小主体的尺度归一化。窄连接优先，但不自动接受。
        edge = cv2.dilate(a.astype("uint8"), np.ones((3, 3), np.uint8)).astype(bool) & b
        score = float(edge.sum() / np.sqrt(min(a.sum(), b.sum())))
        proposals.append(dict(mask=a, score=score))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    contour = cv2.approxPolyDP(
        contour, PARTITION_RULES["contour_epsilon"] * cv2.arcLength(contour, True), True
    )
    hull = cv2.convexHull(contour, returnPoints=False)
    defects = (
        cv2.convexityDefects(contour, hull)
        if len(contour) > 3 and len(hull) > 2
        else None
    )
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

    for ratio in PARTITION_RULES["core_ratios"]:
        n, labels, stats, _ = cv2.connectedComponentsWithStats(
            (distance > distance.max() * ratio).astype("uint8")
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
        if len(ids) != 2:
            continue
        fields = [
            cv2.distanceTransform(
                (labels != i).astype("uint8"), cv2.DIST_L2, cv2.DIST_MASK_PRECISE
            )
            for i in ids
        ]
        add(fields[0] <= fields[1])
    chosen = []
    for p in sorted(proposals, key=lambda p: (p["score"], p["mask"].tobytes())):
        if any(
            min(
                np.count_nonzero(p["mask"] ^ q["mask"]),
                np.count_nonzero(p["mask"] ^ (mask.astype(bool) ^ q["mask"])),
            )
            / area
            < PARTITION_RULES["duplicate_ratio"]
            for q in chosen
        ):
            continue
        chosen.append(p)
        if len(chosen) == PARTITION_RULES["max_candidates"]:
            break
    return chosen


def text_layout(args, _channel):
    """生成整体与二分候选的距离场，排版宿主自动选择。"""
    page = args["page"]
    regions = []
    budget = 0
    for region in page["regions"]:
        mask = (
            read_layout_area(
                Path(args["root"]) / region["layoutArea"]["path"],
                (page["height"], page["width"]),
            )
            > 0
        )
        x, y, w, h = cv2.boundingRect(mask.astype(np.uint8))
        crop = mask[y : y + h, x : x + w]
        choices = [[crop]]
        if region.get("kind") != "unframed":
            choices += [
                [p["mask"], crop & ~p["mask"]] for p in partition_candidates(crop)
            ]
        candidates = []
        for ci, parts in enumerate(choices):
            parts.sort(
                key=lambda part: (
                    (
                        -float(np.nonzero(part)[1].mean()),
                        float(np.nonzero(part)[0].mean()),
                    )
                    if region["direction"] == "vertical-rl"
                    else (
                        float(np.nonzero(part)[0].mean()),
                        float(np.nonzero(part)[1].mean()),
                    )
                )
            )
            blocks = []
            for bi, part in enumerate(parts):
                budget += part.size * 4
                if budget > args["maximumBytes"]:
                    raise ValueError(
                        f"Partition material budget exceeded: {region['regionId']}"
                    )
                bx, by, bw, bh = cv2.boundingRect(part.astype(np.uint8))
                local = part[by : by + bh, bx : bx + bw]
                distance = cv2.distanceTransform(
                    np.pad(local.astype(np.uint8), 1),
                    cv2.DIST_L2,
                    cv2.DIST_MASK_PRECISE,
                )[1:-1, 1:-1]
                distance = np.round(distance * 64) / 64
                yy, xx = np.nonzero(local)
                blocks.append(
                    dict(
                        blockId=f"B{bi + 1}",
                        box=[x + bx, y + by, bw, bh],
                        distance=base64.b64encode(
                            distance.astype("<f4").tobytes()
                        ).decode("ascii"),
                        centroid=[float(xx.mean() + 0.5), float(yy.mean() + 0.5)],
                    )
                )
            candidates.append(dict(candidateId=f"C{ci}", blocks=blocks))
        regions.append(dict(regionId=region["regionId"], candidates=candidates))
    return regions


def text_compose(args, _channel):
    """按原区域顺序写入成功译文，失败区域保留规范化原图。"""
    page = args["page"]
    clean = read_image(args["source"])
    original = read_image(args["original"])
    if clean.shape != original.shape or clean.shape[:2] != (
        page["height"],
        page["width"],
    ):
        raise ValueError("Text base dimensions mismatch")
    result = original.copy()
    fallback = set(args["fallbackRegionIds"])
    clean_regions = {region["regionId"]: region for region in args["cleanRegions"]}
    with open(args["paint"], encoding="utf-8") as file:
        paints = json.load(file)["regions"]
    paints_by_region = {}
    for paint in paints:
        painted = paint["result"]
        if painted["renderStatus"] == "failure":
            continue
        paints_by_region.setdefault(painted["regionId"], []).append(paint)

    for region in page["regions"]:
        region_id = region["regionId"]
        clean_region = clean_regions[region_id]
        if clean_region["status"] != "cleaned" or region_id in fallback:
            continue
        mask_path = clean_region.get("eraseMask")
        if not mask_path:
            raise ValueError("Translated region has no erase mask")
        mask = cv2.imdecode(
            np.fromfile(str(Path(args["root"]) / mask_path), dtype=np.uint8),
            cv2.IMREAD_GRAYSCALE,
        )
        if mask is None or mask.shape != clean.shape[:2]:
            raise ValueError("Invalid erase mask")
        changed = mask > 0
        result[changed] = clean[changed]
        for paint in paints_by_region.get(region_id, []):
            painted = paint["result"]
            x, y, w, h = painted["box"]
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
    return dict(preview=save(args["output"], result))


def qa_preview(args, _channel):
    """在整页成品上按最终输出决定绘制区域框，供一次性视觉确认。"""
    image = read_image(args["source"])
    entries = {entry.get("regionId"): entry for entry in args["entries"]}
    for region in args["page"]["regions"]:
        entry = entries[region["regionId"]]
        codes = {reason["code"] for reason in entry["reasons"]}
        if "translation_incomplete" in codes:
            color = (0, 220, 255)  # 黄色：尚未完成或需要判断。
        elif entry["status"] == "failure":
            color = (0, 0, 230)  # 红色：消字或排版失败。
        elif entry["output"] == "original":
            color = (140, 140, 140)  # 灰色：最终输出原图。
        else:
            color = (20, 190, 20)  # 绿色：最终输出译文。
        mask = read_layout_area(
            Path(args["root"]) / region["layoutArea"]["path"],
            (args["page"]["height"], args["page"]["width"]),
        )
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(image, contours, -1, color, 3, cv2.LINE_AA)
        x, y, _, _ = cv2.boundingRect(mask)
        cv2.putText(image, region["regionId"], (x, max(18, y)), 0, 0.55, color, 2)
    return dict(preview=save(args["output"], image))


def encode_output(args, _channel):
    """按原扩展名编码最终页面，JPEG 输出不携带原稿方向元数据。"""
    image = read_image(args["source"])
    extension = args["extension"].lower()
    if extension not in (".png", ".jpg", ".jpeg"):
        raise ValueError("Unsupported image output format")
    parameters = [cv2.IMWRITE_JPEG_QUALITY, 95] if extension != ".png" else []
    ok, data = cv2.imencode(
        ".jpg" if extension == ".jpeg" else extension, image, parameters
    )
    if not ok:
        raise ValueError("Image output encoding failed")
    output = Path(args["output"])
    output.parent.mkdir(parents=True, exist_ok=True)
    data.tofile(str(output))
    return dict(path=str(output.resolve()))


COMMANDS = {
    "create": create,
    "pack": pack,
    "text_layout": text_layout,
    "text_compose": text_compose,
    "qa_preview": qa_preview,
    "encode_output": encode_output,
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
