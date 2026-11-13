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
CONF, IOU, MAX_DET = 0.1, 0.7, 300
COLOR_DISTANCE, INSET = 32, 1
INPAINT_EDGE, CONTEXT_RATIO, CONTEXT_MIN, MODEL_STRIDE = 2048, 0.35, 64, 64


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


def extract_fill(image, polygon, color, mode):
    """两种填色共享闭合轮廓校验，solid 另处理灰度变化和缝隙。"""
    h, w = image.shape[:2]
    hint = np.zeros((h, w), np.uint8)
    cv2.fillPoly(hint, [polygon], 255)
    x, y, bw, bh = cv2.boundingRect(polygon)
    pad = max(10, round(max(bw, bh) * (2 if mode == "solid" else 1)))
    x0, y0, x1, y1 = (
        max(0, x - pad),
        max(0, y - pad),
        min(w, x + bw + pad),
        min(h, y + bh + pad),
    )
    crop = image[y0:y1, x0:x1]
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(float)
    target = cv2.cvtColor(np.uint8([[color]]), cv2.COLOR_BGR2LAB)[0, 0].astype(float)
    if mode == "solid" and int(max(color)) - int(min(color)) <= 25:
        channels = crop.astype(np.int16)
        near = (
            (channels.max(axis=2) - channels.min(axis=2) <= 22)
            & (channels.min(axis=2) >= 150)
        ).astype(np.uint8)
    else:
        near = (np.linalg.norm(lab - target, axis=2) <= COLOR_DISTANCE).astype(np.uint8)
    if mode == "solid":
        kernel_size = max(3, round(max(h, w) / 640) * 2 + 1)
        near = 1 - cv2.morphologyEx(
            1 - near, cv2.MORPH_CLOSE, np.ones((kernel_size, kernel_size), np.uint8)
        )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(near, 8)
    overlap = hint[y0:y1, x0:x1] > 0
    scores = np.bincount(labels[overlap], minlength=count)
    scores[0] = 0
    if scores.max() < 4:
        return (None, "no background component")
    component = (labels == scores.argmax()).astype(np.uint8)
    if (
        component[:, 0].any()
        or component[:, -1].any()
        or component[0].any()
        or component[-1].any()
    ):
        return (None, "open contour reaches search boundary")
    contours, _ = cv2.findContours(
        component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    filled = np.zeros_like(component)
    cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
    filled = cv2.erode(filled, np.ones((3, 3), np.uint8), iterations=INSET)
    if np.count_nonzero(filled & hint[y0:y1, x0:x1]) < 0.65 * np.count_nonzero(overlap):
        return (None, "insufficient text-area coverage")
    if mode == "solid" and np.count_nonzero(filled) > 6 * np.count_nonzero(hint):
        return (None, "region too large for hint")
    result = np.zeros((h, w), np.uint8)
    result[y0:y1, x0:x1] = filled
    return (result, "accepted")


def runs(values):
    """把连续前景投影转为行列区间，供字形测量复核。"""
    changes = np.diff(np.r_[False, values, False].astype(int))
    return list(zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)))


def estimate(image):
    """只在已确认文字区域估计主体字形，质量不足时返回不确定。"""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    threshold, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    border = np.concatenate([gray[0], gray[-1], gray[:, 0], gray[:, -1]])
    dark = np.median(border) >= threshold
    estimates = []
    details = []
    for delta in [-20, 0, 20]:
        cutoff = np.clip(threshold + delta, 1, 254)
        mask = (gray < cutoff) if dark else (gray > cutoff)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
        eligible = []
        for x, y, w, h, area in stats[1:]:
            if area < 3 or min(w, h) < 2 or max(w, h) > min(gray.shape) * 0.85:
                continue
            if x == 0 or y == 0 or x + w >= gray.shape[1] or y + h >= gray.shape[0]:
                continue
            if max(w / h, h / w) > 3.5:
                continue
            eligible.append((x, y, w, h, area))
        if not eligible:
            continue
        cc = np.array(eligible)
        extents = np.maximum(cc[:, 2], cc[:, 3])
        weights = np.sqrt(cc[:, 4])
        candidates = np.unique(extents)
        scores = [
            weights[(extents >= v * 0.8) & (extents <= v * 1.2)].sum()
            for v in candidates
        ]
        seed = float(candidates[np.argmax(scores)])
        cluster = (extents >= seed * 0.8) & (extents <= seed * 1.2)
        seed = float(np.median(extents[cluster]))
        strength = float(weights[cluster].sum() / weights.sum())
        axes = []
        for axis in [0, 1]:
            profile = mask.sum(axis=axis)
            active = (profile >= max(2, profile.max() * 0.12)).astype(np.uint8)
            kernel = max(1, round(seed * 0.1))
            active = (
                cv2.morphologyEx(
                    active.reshape(1, -1),
                    cv2.MORPH_CLOSE,
                    np.ones((1, kernel), np.uint8),
                )[0]
                > 0
            )
            bands = [
                (a, b) for a, b in runs(active) if seed * 0.6 <= b - a <= seed * 1.4
            ]
            score = (
                float(np.median([profile[a:b].sum() / (b - a) ** 2 for a, b in bands]))
                if bands
                else 0
            )
            axes.append((score, bands))
        axis = int(axes[1][0] > axes[0][0])
        bands = axes[axis][1]
        projected = float(np.median([b - a for a, b in bands])) if bands else seed
        # Projection can restore radicals disconnected inside one character, but not merge whole lines.
        value = projected if seed * 0.85 <= projected <= seed * 1.25 else seed
        estimates.append(value)
        details.append(
            dict(
                axis=axis,
                components=cc.tolist(),
                cluster=int(cluster.sum()),
                strength=strength,
                density=float(mask.mean()),
                eligibleCoverage=float(cc[:, 4].sum() / max(1, mask.sum())),
            )
        )
    if not estimates:
        return dict(status="uncertain", reason="no_body_components", value=None)
    best = details[len(details) // 2]
    value = float(np.median(estimates))
    spread = (max(estimates) - min(estimates)) / max(value, 1)
    reliable = (
        len(estimates) == 3
        and spread <= 0.18
        and best["cluster"] >= 4
        and best["strength"] >= 0.5
        and 0.01 < best["density"] < 0.45
    )
    large = [c for c in best["components"] if max(c[2], c[3]) > value * 1.4]
    mixed = (
        len(large) >= 2
        and sum(c[4] for c in large) > sum(c[4] for c in best["components"]) * 0.25
    )
    unexplained = best["eligibleCoverage"] < 0.6
    reliable = reliable and not mixed and not unexplained
    reason = (
        "mixed_or_touching_glyphs"
        if mixed
        else (
            "unexplained_foreground"
            if unexplained
            else "insufficient_or_unstable_components"
        )
    )
    return dict(
        status="measured" if reliable else "uncertain",
        reason=None if reliable else reason,
        value=value,
        axis=best["axis"],
    )


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


def polygons(shapes, width, height):
    """所有人工多边形在原图像素网格上合并。"""
    mask = np.zeros((height, width), np.uint8)
    for shape in shapes:
        points = np.rint([[p["x"], p["y"]] for p in shape]).astype(np.int32)
        cv2.fillPoly(mask, [points], 255)
    return mask


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
    candidates = []
    for index, (box, mask) in enumerate(zip(boxes, masks)):
        x0, y0, x1, y1, score, label = box
        mask_file = save(root / f"candidate-{index}.png", mask.astype(np.uint8) * 255)
        contours, _ = cv2.findContours(
            mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        candidates.append(
            dict(
                index=index,
                kind=["frame", "balloon", "text"][int(label)],
                score=float(score),
                uncertain=bool(score < 0.25),
                box=dict(
                    x=float(x0),
                    y=float(y0),
                    width=float(x1 - x0),
                    height=float(y1 - y0),
                ),
                mask=mask_file,
                polygons=[
                    [dict(x=int(x), y=int(y)) for x, y in contour[:, 0]]
                    for contour in contours
                    if len(contour) >= 3
                ],
            )
        )
        cv2.rectangle(
            preview,
            (round(x0), round(y0)),
            (round(x1), round(y1)),
            (0, 0, 255),
            max(1, round(max(h, w) / 1000)),
        )
        cv2.putText(
            preview,
            str(index),
            (round(x0), max(20, round(y0))),
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
        preview=str((root / "preview.png").resolve()),
        previewScale=scale,
    )


def repair(args, channel):
    """同页修复作业共用填色快照，每组保留独立的合成掩码。"""
    page = args["page"]
    root = Path(args["output"])
    root.mkdir(parents=True, exist_ok=True)
    image = read_image(args["source"])
    h, w = image.shape[:2]
    if (w, h) != (page["width"], page["height"]):
        raise ValueError("Page dimensions differ from original")
    base = image.copy()
    occupied = np.zeros((h, w), np.uint8)
    masks, groups, jobs = {}, [], []
    for group in page["groups"]:
        gid = group["groupId"]
        mask = polygons(group["areas"], w, h)
        if group.get("mask"):
            file = Path(args["root"]) / group["mask"]["path"]
            with file.open("rb") as stream:
                if (
                    hashlib.file_digest(stream, "sha256").hexdigest()
                    != group["mask"]["sha256"]
                ):
                    raise ValueError("Mask digest changed")
            custom = cv2.imdecode(np.fromfile(file, np.uint8), cv2.IMREAD_GRAYSCALE)
            if (
                custom is None
                or custom.shape != (h, w)
                or not np.isin(custom, [0, 255]).all()
            ):
                raise ValueError("Expected an original-size binary mask")
            mask |= custom
        protection = polygons(group["protection"], w, h)
        mask[protection > 0] = 0
        reason = None
        if group["mode"] in ("basic", "solid"):
            filled = np.zeros_like(mask)
            for shape in group["areas"]:
                polygon = np.rint([[p["x"], p["y"]] for p in shape]).astype(np.int32)
                hint = polygons([shape], w, h)
                values = image[hint > 0]
                bins = values // 32
                keys = (
                    bins[:, 0].astype(int) * 64
                    + bins[:, 1].astype(int) * 8
                    + bins[:, 2]
                )
                key = np.bincount(keys, minlength=512).argmax()
                color = np.median(values[keys == key], axis=0).astype(np.uint8)
                found, status = extract_fill(image, polygon, color, group["mode"])
                if found is None:
                    reason = status
                    break
                # 人工确认范围是编辑授权的硬边界，轮廓算法不能扩大它。
                found &= mask
                filled |= found
            if reason is None:
                mask = filled
                values = image[mask > 0]
                if not len(values):
                    reason = "empty_fill"
                else:
                    bins = values // 32
                    keys = (
                        bins[:, 0].astype(int) * 64
                        + bins[:, 1].astype(int) * 8
                        + bins[:, 2]
                    )
                    color = (
                        np.median(
                            values[keys == np.bincount(keys, minlength=512).argmax()],
                            axis=0,
                        )
                        .round()
                        .astype(np.uint8)
                    )
                    base[mask > 0] = color
        if np.any((occupied > 0) & (mask > 0)):
            raise ValueError("Edit groups overlap; merge the groups")
        occupied |= mask
        masks[gid] = mask
        if group["mode"] == "inpaint" and mask.any():
            jobs.append(gid)
        groups.append(
            dict(
                groupId=gid,
                ready=reason is None and group["mode"] != "preserve",
                reason=reason or ("preserve" if group["mode"] == "preserve" else None),
                mask=save(root / f"{gid}-mask.png", mask),
            )
        )
    # 所有裁图读取同一个填色底图与全页掩码，只有归属组的确认像素回贴。
    scale = INPAINT_EDGE / max(h, w)
    sh, sw = round(h * scale), round(w * scale)
    union = np.zeros((h, w), np.uint8)
    for gid in jobs:
        union |= masks[gid]
    snapshot = cv2.resize(base, (sw, sh), interpolation=cv2.INTER_CUBIC)
    scaled_mask = cv2.resize(union, (sw, sh), interpolation=cv2.INTER_AREA) > 0
    scaled_mask = cv2.dilate(scaled_mask.astype(np.uint8), np.ones((3, 3), np.uint8))
    crops = []
    for gid in jobs:
        x, y, bw, bh = cv2.boundingRect(masks[gid])
        margin = max(CONTEXT_MIN, round(max(bw, bh) * CONTEXT_RATIO))
        x0 = max(0, math.floor((x - margin) * sw / w))
        y0 = max(0, math.floor((y - margin) * sh / h))
        x1 = min(sw, math.ceil((x + bw + margin) * sw / w))
        y1 = min(sh, math.ceil((y + bh + margin) * sh / h))
        crops.append((x0, y0, x1, y1, [gid]))
    padded = lambda v: math.ceil(v / MODEL_STRIDE) * MODEL_STRIDE
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
        for gid in owners:
            yy, xx = np.nonzero(masks[gid])
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
    return dict(base=save(root / "base.png", base), groups=groups)


def layout(args, _channel):
    """从原图测量字形，用保护区和描边收缩排版空间。"""
    page = args["page"]
    root = Path(args["output"])
    root.mkdir(parents=True, exist_ok=True)
    image = read_image(args["source"])
    h, w = image.shape[:2]
    regions = []
    for region in page["regions"]:
        if region["disposition"] != "translate":
            continue
        group = next(g for g in page["groups"] if region["regionId"] in g["regionIds"])
        allowed = polygons(region["layout"], w, h)
        allowed[polygons(group["protection"], w, h) > 0] = 0
        x, y, bw, bh = cv2.boundingRect(allowed)
        if not bw or not bh:
            raise ValueError("Empty layout region")
        inset = max(3, round(min(bw, bh) * 0.035)) + math.ceil(
            region["style"]["strokeWidth"]
        )
        safe = cv2.erode(allowed, np.ones((2 * inset + 1, 2 * inset + 1), np.uint8))
        roi = region["source"][0]
        rx, ry = math.floor(roi["x"]), math.floor(roi["y"])
        rw, rh = math.ceil(roi["width"]), math.ceil(roi["height"])
        measured = estimate(image[ry : ry + rh, rx : rx + rw])
        regions.append(
            dict(
                regionId=region["regionId"],
                groupId=group["groupId"],
                x=x,
                y=y,
                width=bw,
                height=bh,
                mask=save(
                    root / f"{region['regionId']}-safe.png",
                    safe[y : y + bh, x : x + bw],
                ),
                measurement={
                    k: measured.get(k) for k in ("status", "reason", "value", "axis")
                },
            )
        )
    return regions


def composite(args, _channel):
    """先核对全部文字层，再按编辑组恢复失败结果。"""
    original = read_image(args["source"])
    base = read_image(args["base"])
    result = original.copy()
    occupied = np.zeros(original.shape[:2], np.int32)
    rejected = set()
    # 先核对全部文字层，再按组决定底图与文字能否一起交付。
    for index, group in enumerate(args["groups"], 1):
        if not group["accepted"]:
            continue
        for tile in group["tiles"]:
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
    for index, group in enumerate(args["groups"], 1):
        if not group["accepted"] or index in rejected:
            continue
        mask = (
            cv2.imdecode(np.fromfile(group["mask"], np.uint8), cv2.IMREAD_GRAYSCALE) > 0
        )
        result[mask] = base[mask]
        for tile in group["tiles"]:
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
        rejectedGroups=[
            args["groups"][index - 1]["groupId"] for index in sorted(rejected)
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
        members.update(
            {
                g["mask"]["path"]: g["mask"]["sha256"]
                for p in book["pages"]
                for g in p["groups"]
                if g.get("mask")
            }
        )
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
