"""区域检测、消字候选、文字分区与离线归档。推理由宿主 Worker 执行。"""
import hashlib
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
from lg.image import fill, materials, repair
from lg.inference import text_detection
from lg.inference.channel import Channel

cv2.setNumThreads(1)
IMAGE_SIZE, MODEL_STRIDE = 1600, 32
CONF, IOU, MAX_DET, MAX_NMS = 0.25, 0.7, 300, 30000
TEXT_SIDE = 1280
UNFRAMED_PADDING_RATIO = 0.5

def read_image(path):
    """读取宿主已规范化的 RGB PNG，返回 OpenCV 使用的 BGR 像素。"""
    encoded = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if image is None or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
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


def file_sha256(path):
    """摘要绑定 PNG 字节，供宿主验证冻结选区与运行产物。"""
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


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
    padded = cv2.copyMakeBorder(resized, round(ph / 2 - 0.1), round(ph / 2 + 0.1),
                               round(pw / 2 - 0.1), round(pw / 2 + 0.1), cv2.BORDER_CONSTANT, value=(114, 114, 114))
    return np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255


def postprocess(raw, proto, shape, input_shape):
    """复现 Ultralytics retina_masks：先恢复 logits，再裁框及二值化，逐实例释放整页数组。"""
    ih, iw = input_shape
    # Worker 已校验原生输出的布局与有限值，通道只传连续 float32。
    pred = raw[0].T
    scores = pred[:, 4]
    candidates = np.flatnonzero(scores > CONF)
    candidates = candidates[np.argsort(-scores[candidates], kind="stable")][:MAX_NMS]
    boxes = np.concatenate((pred[:, :2] - pred[:, 2:4] / 2, pred[:, :2] + pred[:, 2:4] / 2), 1)
    area = (boxes[:, 2:] - boxes[:, :2]).prod(1)
    kept = []
    while len(candidates) and len(kept) < MAX_DET:
        i, candidates = candidates[0], candidates[1:]
        kept.append(i)
        inter = np.maximum(0, np.minimum(boxes[i, 2:], boxes[candidates, 2:]) - np.maximum(boxes[i, :2], boxes[candidates, :2])).prod(1)
        overlap = inter / (area[i] + area[candidates] - inter + 1e-7)
        candidates = candidates[overlap <= IOU]
    h, w = shape
    gain = min(ih / h, iw / w)
    pad = np.array([round((iw - w * gain) / 2 - 0.1), round((ih - h * gain) / 2 - 0.1)] * 2)
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
        mask = cv2.resize(logits[top:bottom, left:right], (w, h), interpolation=cv2.INTER_LINEAR) > 0
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
        yield dict(box=box.tolist(), score=float(scores[i])), mask.astype(np.uint8) * 255


def prepare(args, channel):
    """按分数优先分配气泡区域，冻结像素归属后再交给宿主确认。"""
    image = read_image(args["source"])
    h, w = image.shape[:2]
    tensor = model_input(image)
    raw, proto = forward(channel, "bubble", tensor)
    root = Path(args["output"])
    layout_area_root = Path(args["layoutAreaRoot"])
    page_id = args["pageId"]
    occupied = np.zeros((h, w), np.uint16)  # 保存候选序号，支持重叠证据追溯。
    preview = image.copy()
    candidates, regions, crops, backgrounds = [], [], {}, {}
    for index, (record, raw_mask) in enumerate(postprocess(raw, proto, (h, w), tensor.shape[2:]), 1):
        rid = f"r{index:04d}"
        raw_path = save(root / "raw" / f"{rid}.png", raw_mask)
        inner = fill.inset_selection(raw_mask)
        candidate = dict(regionId=rid, **record, rawMask=raw_path, overlaps=[], status="ready")
        candidates.append(candidate)
        if not np.any(inner):
            candidate["status"] = "empty_area"
            continue
        candidate["overlaps"] = [f"r{int(owner):04d}" for owner in np.unique(occupied[inner > 0]) if owner]
        inner[occupied > 0] = 0
        if not np.any(inner):
            candidate["status"] = "covered"
            continue
        occupied[inner > 0] = index
        member = f"layout-areas/{page_id}/{rid}.png"
        target = save(layout_area_root / member, inner)
        layout_area = dict(path=member, sha256=file_sha256(target))
        candidate["layoutArea"] = layout_area
        for mask, tint in ((raw_mask, (0, 150, 255)), (inner, (0, 220, 0))):
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(preview, contours, -1, tint, 1)
        x, y, bw, bh = cv2.boundingRect(raw_mask)
        cv2.putText(preview, rid, (x, max(16, y)), 0, 0.5, (0, 0, 230), 1)
        crops[rid] = save(root / "crops" / f"{rid}.png", image[y:y + bh, x:x + bw])
    text_boxes = detect_text(image, channel)
    text_mask = np.zeros((h, w), np.uint8)
    for record in text_boxes:
        cv2.fillConvexPoly(text_mask, np.asarray(record["box"], np.int32), 255)
    def analyzed_selections():
        """从本次像素归属生成草稿并逐项填色，避免回读刚写出的掩膜。"""
        for index, candidate in enumerate(candidates, 1):
            if "layoutArea" not in candidate:
                continue
            mask = (occupied == index).astype(np.uint8) * 255
            background, color = fill.analyze_background(image, mask, text_mask)
            candidate["background"] = background
            backgrounds[candidate["regionId"]] = background
            if color is not None:
                candidate["color"] = color
            region = dict(regionId=candidate["regionId"], kind="bubble",
                          textBoxIds=[], layoutArea=candidate["layoutArea"], direction=None,
                          disposition="translate", backgroundColor=color)
            regions.append(region)
            if background["route"] == "fill":
                yield mask, color

    fill_preview = fill.render_fill(image, analyzed_selections())
    scale = min(1.0, IMAGE_SIZE / max(h, w))
    preview_path = save(root / "preview.png", cv2.resize(preview, (round(w * scale), round(h * scale))))
    fill_path = save(root / "fill-preview.png", fill_preview)
    text_box_records = []
    for index, record in enumerate(text_boxes, 1):
        box = record["box"]
        support = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(support, np.asarray(box, np.int32), 255)
        ids, counts = np.unique(occupied[support > 0], return_counts=True)
        ranked = [(count, int(owner)) for owner, count in zip(ids, counts) if owner]
        owner = max(ranked)[1] if ranked and max(ranked)[0] >= np.count_nonzero(support) * 0.5 else None
        text_box_id = f"t{index:04d}"
        owner_region_id = f"r{owner:04d}" if owner else None
        if owner_region_id:
            next(region for region in regions if region["regionId"] == owner_region_id)[
                "textBoxIds"
            ].append(text_box_id)
        text_box_records.append(
            dict(textBoxId=text_box_id, box=np.asarray(box).tolist(),
                 coreBox=np.asarray(record["coreBox"]).tolist(),
                 ownerRegionId=owner_region_id)
        )
    return dict(width=w, height=h, preview=preview_path, previewScale=scale, fillPreview=fill_path,
                crops=crops, candidates=candidates, draftRegions=regions,
                textBoxes=text_box_records, backgrounds=backgrounds)


def read_layout_area(file, layout_area, shape):
    """对同一份字节校验摘要并解码，确保填色消费确认后的二值排版区域。"""
    encoded = np.fromfile(str(file), dtype=np.uint8)
    if hashlib.sha256(encoded).hexdigest() != layout_area["sha256"]:
        raise ValueError("Region mask digest mismatch")
    mask = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if mask is None or mask.dtype != np.uint8 or mask.shape != shape:
        raise ValueError("Invalid binary selection dimensions")
    if not np.all((mask == 0) | (mask == 255)) or not np.any(mask):
        raise ValueError("Layout area must be nonempty and binary")
    return mask


def detect_text(image, channel):
    """整页检测保留结构，原尺寸分块补回缩放后丢失的小字。"""
    height, width = image.shape[:2]

    def run(frame, x=0, y=0):
        """检测一个原尺寸分块，并把两种框移回整页坐标。"""
        tensor = text_detection.det_input(frame, side=TEXT_SIDE, upscale=False)
        probability, = forward(channel, "text", tensor)
        records = text_detection.det_box_records(
            probability, *frame.shape[:2], round_coords=True
        )
        for record in records:
            for name in ("box", "coreBox"):
                record[name] = record[name] + [x, y]
        return records

    records = run(image)
    if max(height, width) > TEXT_SIDE:
        stride = TEXT_SIDE - TEXT_SIDE // 8
        xs = sorted(set(range(0, max(1, width - TEXT_SIDE + 1), stride)) | {max(0, width - TEXT_SIDE)})
        ys = sorted(set(range(0, max(1, height - TEXT_SIDE + 1), stride)) | {max(0, height - TEXT_SIDE)})
        for y in ys:
            for x in xs:
                records.extend(run(image[y : y + TEXT_SIDE, x : x + TEXT_SIDE], x, y))

    def overlap(a, b):
        """用较小主体的交叠比例合并整页与分块的重复检测。"""
        area_a = abs(cv2.contourArea(a.astype(np.float32)))
        area_b = abs(cv2.contourArea(b.astype(np.float32)))
        if min(area_a, area_b) <= 0:
            return 0
        intersection, _ = cv2.intersectConvexConvex(
            a.astype(np.float32), b.astype(np.float32)
        )
        return intersection / min(area_a, area_b)

    chosen = []
    for record in sorted(records, key=lambda item: -item["score"]):
        if any(overlap(record["coreBox"], item["coreBox"]) >= 0.6 for item in chosen):
            continue
        chosen.append(record)
    ordered = text_detection.sort_boxes([item["box"] for item in chosen])
    by_box = {item["box"].tobytes(): item for item in chosen}
    return [by_box[box.tobytes()] for box in ordered]


def layout_areas(args, _channel):
    """从已检测文字框生成互斥的无框排版区域。"""
    page = args["page"]
    root, output = Path(args["root"]), Path(args["output"])
    image = read_image(args["source"])
    h, w = image.shape[:2]
    occupied = np.zeros((h, w), np.uint8)
    for region in page["regions"]:
        if region["kind"] != "bubble" or not region["layoutArea"]:
            continue
        occupied |= read_layout_area(root / region["layoutArea"]["path"], region["layoutArea"], (h, w))
    boxes = [np.asarray(box["box"], np.int32) for box in args["textBoxes"]]
    box_ids = {box["textBoxId"]: index for index, box in enumerate(args["textBoxes"])}
    raw = []
    for group in args["groups"]:
        mask = np.zeros((h, w), np.uint8)
        sizes = []
        for text_box_id in group["textBoxIds"]:
            index = box_ids[text_box_id]
            cv2.fillConvexPoly(mask, boxes[index], 255)
            core = np.asarray(args["textBoxes"][index]["coreBox"], np.float32)
            sizes.append(
                min(np.linalg.norm(core[0] - core[1]), np.linalg.norm(core[0] - core[3]))
            )
        if not np.any(mask):
            raise ValueError(f"Empty region group: {group['regionId']}")
        padding = max(4, round(float(np.median(sizes)) * UNFRAMED_PADDING_RATIO))
        raw.append((group, mask, padding))
    chosen = None
    for scale in range(10, -1, -1):
        claimed = occupied.copy()
        candidates = []
        valid = True
        for group, mask, requested in raw:
            padding = round(requested * scale / 10)
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (padding * 2 + 1, padding * 2 + 1)
            )
            expanded = cv2.dilate(mask, kernel) if padding else mask.copy()
            if np.any((expanded > 0) & (claimed > 0)):
                valid = False
                break
            claimed |= expanded
            candidates.append((group, expanded))
        if valid:
            chosen = candidates
            break
    if chosen is None:
        raise ValueError("Unframed text groups overlap existing regions")
    text_mask = np.zeros((h, w), np.uint8)
    for box in boxes:
        cv2.fillConvexPoly(text_mask, box, 255)
    regions, backgrounds = [], {}
    for group, mask in chosen:
        member = f"layout-areas/{page['pageId']}/{group['regionId']}.png"
        file = save(output / member, mask)
        background, color = fill.analyze_background(image, mask, text_mask)
        backgrounds[group["regionId"]] = background
        regions.append(dict(regionId=group["regionId"], kind="unframed",
                            disposition="translate", textBoxIds=group["textBoxIds"],
                            layoutArea=dict(path=member, sha256=file_sha256(file)),
                            direction=None, backgroundColor=color))
    return dict(regions=regions, backgrounds=backgrounds)


def _box_mask(shape, layout_area, boxes):
    """扩展文字框并裁到区域内，供无框填色和 LaMa 共用。"""
    mask = np.zeros(shape, np.uint8)
    for box in boxes:
        cv2.fillConvexPoly(mask, np.asarray(box, np.int32), 255)
    if np.any(mask):
        mask = cv2.dilate(mask, repair.ellipse(2)) & layout_area
    return mask


def erase_candidates(args, channel):
    """各区域从同一原图生成少量去重候选，并输出按页拼图。"""
    page, root = args["page"], Path(args["root"])
    output = Path(args["output"])
    image = read_image(args["source"])
    h, w = image.shape[:2]
    boxes = {box["textBoxId"]: box["box"] for box in page["textBoxes"]}
    fill_regions = set(args["fillRegionIds"])
    region_results = []
    for region in page["regions"]:
        if region["disposition"] != "translate":
            continue
        rid = region["regionId"]
        layout_area = read_layout_area(root / region["layoutArea"]["path"], region["layoutArea"], (h, w))
        relevant = [boxes[text_box_id] for text_box_id in region["textBoxIds"]]
        sx, sy, sw, sh = cv2.boundingRect(layout_area)
        margin = max(12, round(max(sw, sh) * 0.2))
        x0, y0 = max(0, sx - margin), max(0, sy - margin)
        x1, y1 = min(w, sx + sw + margin), min(h, sy + sh + margin)
        original_crop = save(output / rid / "original.png", image[y0:y1, x0:x1])
        proposals, diagnostics = [], []
        if rid in fill_regions and isinstance(region["backgroundColor"], list):
            mask = layout_area if region["kind"] == "bubble" else _box_mask((h, w), layout_area, relevant)
            if np.any(mask):
                proposals.append(("fill", mask))
        for method, build in (("strokes", lambda: repair.text_mask(image, layout_area, relevant)),
                              ("boxes", lambda: _box_mask((h, w), layout_area, relevant))):
            try:
                mask = build()
                if not np.any(mask):
                    raise ValueError("Empty repair mask")
                proposals.append((method, mask))
            except ValueError as error:
                diagnostics.append(dict(method=method, error=str(error)))
        candidates, repair_masks = [], []
        for method, mask in proposals:
            # 同一 LaMa 输入只推理一次，填色与 LaMa 保留各自结果。
            if method != "fill":
                if any(np.array_equal(mask, previous) for previous in repair_masks):
                    continue
                repair_masks.append(mask)
            try:
                if method == "fill":
                    result = fill.render_fill(image, [(mask, region["backgroundColor"])])
                else:
                    result = image.copy()
                    result[mask > 0] = repair.inpaint(image, mask, lambda tensor: forward(channel, "inpaint", tensor)[0])
                cropped_mask = mask[y0:y1, x0:x1]
                crop = result[y0:y1, x0:x1]
                index = len(candidates)
                candidate_id = chr(ord("A") + index)
                mask_file = save(output / rid / f"{candidate_id}-mask.png", cropped_mask)
                crop_file = save(output / rid / f"{candidate_id}.png", crop)
                candidates.append(dict(candidateId=candidate_id, method=method,
                                       box=[x0, y0, x1 - x0, y1 - y0], crop=crop_file,
                                       cropSha256=file_sha256(crop_file), eraseMask=mask_file,
                                       eraseMaskSha256=file_sha256(mask_file)))
            except ValueError as error:
                diagnostics.append(dict(method=method, error=str(error)))
        region_results.append(dict(regionId=rid, originalCrop=original_crop,
                                   candidates=candidates, diagnostics=diagnostics))
    sheets = materials.candidate_sheets(region_results, output / "materials") if region_results else []
    for region in region_results:
        del region["originalCrop"]
    return dict(regions=region_results, materials=sheets)


def compose_candidates(args, _channel):
    """只把已选候选掩码内像素回贴到规范化原图。"""
    page, root = args["page"], Path(args["root"])
    workspace_root, output = Path(args["workspaceRoot"]), Path(args["output"])
    image = read_image(args["source"])
    result = image.copy()
    union = np.zeros(image.shape[:2], np.uint8)
    regions = []
    for item in args["selected"]:
        region = next(r for r in page["regions"] if r["regionId"] == item["regionId"])
        if item["disposition"] == "preserve":
            regions.append(dict(regionId=region["regionId"], disposition="preserve",
                                preserveReason=item["preserveReason"]))
            continue
        candidate = item["candidate"]
        for key in ("crop", "eraseMask"):
            if file_sha256(root / candidate[key]) != candidate[f"{key}Sha256"]:
                raise ValueError("Candidate artifact digest mismatch")
        x, y, w, h = candidate["box"]
        if x < 0 or y < 0 or x + w > page["width"] or y + h > page["height"]:
            raise ValueError("Candidate crop exceeds page")
        crop = read_image(root / candidate["crop"])
        mask = cv2.imdecode(np.fromfile(str(root / candidate["eraseMask"]), np.uint8), cv2.IMREAD_GRAYSCALE)
        if crop.shape[:2] != (h, w) or mask is None or mask.shape != (h, w):
            raise ValueError("Candidate crop dimensions mismatch")
        full = np.zeros(image.shape[:2], np.uint8)
        full[y:y + h, x:x + w] = mask
        layout_area = read_layout_area(workspace_root / region["layoutArea"]["path"], region["layoutArea"], image.shape[:2])
        if np.any((full > 0) & (layout_area == 0)) or np.any((full > 0) & (union > 0)):
            raise ValueError("Selected candidate masks overlap or escape region")
        changed = mask > 0
        result[y:y + h, x:x + w][changed] = crop[changed]
        union |= full
        mask_file = save(output / "masks" / f"{region['regionId']}.png", full)
        regions.append(dict(regionId=region["regionId"], disposition="translate",
                            eraseMask=mask_file, eraseMaskSha256=file_sha256(mask_file)))
    clean = save(output / "clean.png", result)
    return dict(clean=clean, cleanSha256=file_sha256(clean), regions=regions)


def pack(args, _channel):
    """按 SDK 已验证的成员清单流式归档。"""
    with zipfile.ZipFile(args["output"], "x", allowZip64=False) as archive:
        for member, value in (("image.json", args["book"]), ("items.json", args["records"]), ("clean.json", args["clean"])):
            archive.writestr(member, json.dumps(value, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)
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
        if region["disposition"] != "translate":
            continue
        mask = (
            read_layout_area(
                Path(args["root"]) / region["layoutArea"]["path"],
                region["layoutArea"],
                (page["height"], page["width"]),
            )
            > 0
        )
        x, y, w, h = cv2.boundingRect(mask.astype(np.uint8))
        crop = mask[y : y + h, x : x + w]
        choices = [[crop]]
        if region.get("kind") != "unframed":
            choices += [[p["mask"], crop & ~p["mask"]] for p in partition_candidates(crop)]
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
        regions.append(
            dict(regionId=region["regionId"], candidates=candidates)
        )
    return regions


def selected_geometry(args):
    """从已选距离场重建块掩码并验证完整覆盖父区域。"""
    page = args["page"]
    regions = []
    for selected in args["selected"]:
        parent = next(
            r for r in page["regions"] if r["regionId"] == selected["regionId"]
        )
        mask = (
            read_layout_area(
                Path(args["root"]) / parent["layoutArea"]["path"],
                parent["layoutArea"],
                (page["height"], page["width"]),
            )
            > 0
        )
        occupied = np.zeros(mask.shape, bool)
        for block in selected["blocks"]:
            x, y, w, h = block["box"]
            distance = np.frombuffer(
                base64.b64decode(block["distance"], validate=True), "<f4"
            ).reshape(h, w)
            part = distance > 0
            if (
                x < 0
                or y < 0
                or x + w > page["width"]
                or y + h > page["height"]
                or not np.any(part)
            ):
                raise ValueError("Invalid partition box")
            if np.any(
                part & (~mask[y : y + h, x : x + w] | occupied[y : y + h, x : x + w])
            ):
                raise ValueError("Partition masks overlap or escape parent")
            occupied[y : y + h, x : x + w] |= part
            regions.append(
                dict(
                    regionId=parent["regionId"],
                    candidateId=selected["candidateId"],
                    blockId=block["blockId"],
                    box=block["box"],
                    centroid=block["centroid"],
                    distance=block["distance"],
                )
            )
        if not np.array_equal(mask, occupied):
            raise ValueError("Partition does not cover parent")
    return regions





def text_compose(args, _channel):
    """独立核对未经裁剪的原生覆盖层，仅合成通过边距和居中门禁的区域。"""
    page, rules = args["page"], args["rules"]
    clean = read_image(args["source"])
    if clean.shape[:2] != (page["height"], page["width"]):
        raise ValueError("Text base dimensions mismatch")
    geometry = {
        (r["regionId"], r["candidateId"], r["blockId"]): r
        for r in selected_geometry(args)
    }
    occupied = np.zeros(clean.shape[:2], bool)
    with open(args["paint"], encoding="utf-8") as file:
        paints = json.load(file)["regions"]
    seen = set()
    for paint in paints:
        result = paint["result"]
        rid = (result["regionId"], result["candidateId"], result["blockId"])
        if rid in seen or rid not in geometry:
            raise ValueError("Text paint region identity mismatch")
        seen.add(rid)
        if result["status"] != "rendered":
            if "png" in paint:
                raise ValueError("Failed region carries text pixels")
            continue
        entry = geometry[rid]
        x, y, w, h = entry["box"]
        if result["box"] != entry["box"]:
            raise ValueError("Text crop mismatch")
        raw = np.frombuffer(base64.b64decode(paint["png"], validate=True), np.uint8)
        overlay = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
        if overlay is None or overlay.dtype != np.uint8 or overlay.shape != (h, w, 4):
            raise ValueError("Invalid text overlay")
        covered = overlay[:, :, 3] > 0
        if not np.any(covered):
            raise ValueError("Rendered text has no visible pixels")
        distance = np.frombuffer(base64.b64decode(entry["distance"]), "<f4").reshape(h, w)
        lower = distance[covered].min() - math.sqrt(2)
        margin = max(rules["minimumMargin"], result["fontSize"] * rules["marginRatio"])
        if lower < margin:
            raise ValueError("Text coverage violates mask margin")
        yy, xx = np.nonzero(covered)
        bounds = [int(xx.min()+x), int(yy.min()+y), int(xx.max()+1+x), int(yy.max()+1+y)]
        axis = 1 if next(r for r in page["regions"] if r["regionId"] == rid[0])["direction"] == "horizontal-tb" else 0
        center = ((yy.min()+yy.max()+1) if axis else (xx.min()+xx.max()+1))/2
        error = abs(center-entry["centroid"][axis])
        tolerance = max(rules["minimumCenterTolerance"], result["fontSize"] * rules["centerToleranceRatio"])
        if error > tolerance or bounds != result["bounds"] or abs(result["margin"]-float(lower)) > 1e-5 or abs(result["centerError"]-float(error)) > 1e-5:
            raise ValueError("Text metrics mismatch")
        if np.any(occupied[y:y+h,x:x+w] & covered):
            raise ValueError("Text block pixels overlap")
        occupied[y:y+h,x:x+w] |= covered
        alpha = overlay[:, :, 3:4].astype(np.float64)/255
        destination = clean[y:y+h, x:x+w]
        composite = np.floor(overlay[:, :, :3]*alpha+destination*(1-alpha)+.5).astype(np.uint8)
        destination[covered] = composite[covered]
    output = save(args["output"], clean)
    return dict(preview=output, previewSha256=file_sha256(output))


COMMANDS = {"prepare": prepare, "layout_areas": layout_areas,
            "erase": erase_candidates, "compose_candidates": compose_candidates, "pack": pack,
            "text_layout": text_layout, "text_compose": text_compose}

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
