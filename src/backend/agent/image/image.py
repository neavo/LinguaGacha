"""气泡实例分割、确认选区纯色填充及离线归档。推理由宿主 Worker 执行。"""
import hashlib
import importlib.util
import json
import math
import shutil
import sys
import threading
import traceback
import zipfile
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(1)
IMAGE_SIZE, MODEL_STRIDE = 1600, 32
CONF, IOU, MAX_DET, MAX_NMS = 0.25, 0.7, 300, 30000
INSET_RATIO, INSET_MIN, INSET_MAX = 0.008, 1, 6
COLOR_BIN, COLOR_DISTANCE = 8, 12
WHITE_MIN, WHITE_SPREAD = 215, 25

def _load_sibling(name, dev_dir):
    """部署目录使用相邻 helper，源码运行使用同一推理模块。"""
    candidate = Path(__file__).with_name(name)
    if not candidate.exists():
        candidate = Path(__file__).parent.parent / dev_dir / name
    spec = importlib.util.spec_from_file_location(f"image_{candidate.stem.replace('-', '_')}", candidate)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_channel_mod = _load_sibling("channel.py", "inference")
Channel = _channel_mod.Channel

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
    if raw.shape != (1, 37, 21 * (ih // 32) * (iw // 32)) or proto.shape != (1, 32, ih // 4, iw // 4):
        raise ValueError("Invalid bubble model output shape")
    if raw.dtype != np.float32 or proto.dtype != np.float32 or not np.isfinite(raw).all() or not np.isfinite(proto).all():
        raise ValueError("Invalid bubble model output values")
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
        # 固定参考为 CPU retina_masks；该实现少于 50 个实例时用四舍五入后的框裁剪。
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


def inset_selection(mask):
    """外轮廓填孔后内缩，内部文字和装饰不再形成保留孔洞。"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
    _, _, w, h = cv2.boundingRect(filled)
    inset = max(INSET_MIN, min(INSET_MAX, round(min(w, h) * INSET_RATIO)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * inset + 1, 2 * inset + 1))
    return cv2.erode(filled, kernel, iterations=1)


def estimate_color(image, mask):
    """在重叠分配前估计内腔主色，输出供确认的 RGB 候选。"""
    pixels = image[mask > 0].astype(np.int16)
    if not len(pixels):
        raise ValueError("empty_selection")
    _, inverse, counts = np.unique(pixels // COLOR_BIN, axis=0, return_inverse=True, return_counts=True)
    color = np.median(pixels[inverse == np.argmax(counts)], axis=0)
    nearby = pixels[np.max(np.abs(pixels - color), axis=1) <= COLOR_DISTANCE]
    color = np.median(nearby, axis=0).round().astype(np.uint8)
    if int(color.min()) >= WHITE_MIN and int(color.max()) - int(color.min()) <= WHITE_SPREAD:
        color[:] = 255
    return color[::-1].tolist()


def prepare(args, channel):
    """按分数优先分配选区，冻结像素归属后再交给宿主确认。"""
    image = read_image(args["source"])
    h, w = image.shape[:2]
    tensor = model_input(image)
    raw, proto = forward(channel, "bubble", tensor)
    root = Path(args["output"])
    selection_root = Path(args["selectionRoot"])
    page_id = args["pageId"]
    occupied = np.zeros((h, w), np.uint16)  # 保存候选序号，支持重叠证据追溯。
    preview, fill_preview = image.copy(), image.copy()
    candidates, regions, crops = [], [], {}
    for index, (record, raw_mask) in enumerate(postprocess(raw, proto, (h, w), tensor.shape[2:]), 1):
        rid = f"r{index:04d}"
        raw_path = save(root / "raw" / f"{rid}.png", raw_mask)
        inner = inset_selection(raw_mask)
        candidate = dict(regionId=rid, **record, rawMask=raw_path, overlaps=[], status="ready")
        candidates.append(candidate)
        if not np.any(inner):
            candidate["status"] = "empty_selection"
            continue
        color = estimate_color(image, inner)
        candidate["overlaps"] = [f"r{int(owner):04d}" for owner in np.unique(occupied[inner > 0]) if owner]
        inner[occupied > 0] = 0
        if not np.any(inner):
            candidate["status"] = "covered"
            continue
        occupied[inner > 0] = index
        member = f"masks/{page_id}/{rid}.png"
        target = save(selection_root / member, inner)
        selection = dict(path=member, sha256=file_sha256(target))
        regions.append(dict(regionId=rid, disposition="translate", selection=selection,
                            direction=None, fill=dict(color=color)))
        candidate["selection"] = selection
        candidate["color"] = color
        fill_preview[inner > 0] = color[::-1]
        for mask, tint in ((raw_mask, (0, 150, 255)), (inner, (0, 220, 0))):
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(preview, contours, -1, tint, 1)
        x, y, bw, bh = cv2.boundingRect(raw_mask)
        cv2.putText(preview, rid, (x, max(16, y)), 0, 0.5, (0, 0, 230), 1)
        crops[rid] = save(root / "crops" / f"{rid}.png", image[y:y + bh, x:x + bw])
    scale = min(1.0, IMAGE_SIZE / max(h, w))
    preview_path = save(root / "preview.png", cv2.resize(preview, (round(w * scale), round(h * scale))))
    fill_path = save(root / "fill-preview.png", fill_preview)
    return dict(width=w, height=h, preview=preview_path, previewScale=scale, fillPreview=fill_path,
                crops=crops, candidates=candidates, draftRegions=regions)


def read_selection(file, selection, shape):
    """对同一份字节校验摘要并解码，确保填色消费确认后的二值选区。"""
    encoded = np.fromfile(str(file), dtype=np.uint8)
    if hashlib.sha256(encoded).hexdigest() != selection["sha256"]:
        raise ValueError("Region mask digest mismatch")
    mask = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if mask is None or mask.dtype != np.uint8 or mask.shape != shape:
        raise ValueError("Invalid binary selection dimensions")
    if not np.all((mask == 0) | (mask == 255)) or not np.any(mask):
        raise ValueError("Selection must be nonempty and binary")
    return mask


def erase(args, _channel):
    """从规范化原图硬填色，非法选区直接失败，返回产物仍需独立验收。"""
    page = args["page"]
    root = Path(args["output"])
    image = read_image(args["source"])
    h, w = image.shape[:2]
    if (w, h) != (page["width"], page["height"]):
        raise ValueError("Page dimensions differ from original")
    base, overlay = image.copy(), image.copy()
    occupied = np.zeros((h, w), np.uint8)
    results = []
    for region in page["regions"]:
        rid = region["regionId"]
        selection = region["selection"]
        mask = None
        source = None
        if selection:
            if selection["path"] != f"masks/{page['pageId']}/{rid}.png":
                raise ValueError("Invalid selection path")
            source = Path(args["root"]) / selection["path"]
            mask = read_selection(source, selection, (h, w))
            if np.any((occupied > 0) & (mask > 0)):
                raise ValueError("Region selections overlap")
            occupied |= mask
        if region["disposition"] == "preserve":
            results.append(dict(regionId=rid, disposition="preserve", preserveReason=region["preserveReason"]))
            continue
        color = (region.get("fill") or {}).get("color")
        if mask is None or not isinstance(color, list) or len(color) != 3 or any(type(c) is not int or not 0 <= c <= 255 for c in color):
            raise ValueError("Translate region requires selection and RGB fill")
        base[mask > 0] = color[::-1]
        overlay[mask > 0] = (60, 60, 230)
        target = root / "masks" / f"{rid}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        results.append(dict(regionId=rid, disposition="translate", mask=str(target.resolve()), maskSha256=selection["sha256"]))
    clean = save(root / "clean.png", base)
    return dict(clean=clean, cleanSha256=file_sha256(clean),
                overlay=save(root / "mask-overlay.png", overlay), regions=results)


def pack(args, _channel):
    """按受控成员清单流式归档；SDK 在发布前通过共享资产入口完整验包。"""
    with zipfile.ZipFile(args["output"], "x", allowZip64=False) as archive:
        for member, value in (("image.json", args["book"]), ("items.json", args["records"]), ("clean.json", args["clean"])):
            archive.writestr(member, json.dumps(value, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)
        for member, source in args["sources"].items():
            archive.write(source, member, compress_type=zipfile.ZIP_STORED)
    return dict(path=args["output"])


COMMANDS = {"prepare": prepare, "erase": erase, "pack": pack}

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
