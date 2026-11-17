"""区域文字的笔画掩码与 LaMa 修复；排版选区始终只限定归属边界。"""

import cv2
import numpy as np

DARK_MAX, WHITE_MIN, WHITE_SPREAD = 150, 220, 30  # 黑字上限与白描边范围。
COMPONENT_AREA_RATIO = 0.0005  # 按文字框短边过滤孤立噪点。
TEXT_PADDING_RATIO, HALO_RATIO, EDGE_RATIO = (
    0.04,
    0.12,
    0.025,
)  # 描边邻域、框外余量与最终外扩。
CONTEXT_RATIO, CONTEXT_MIN, INPUT_EDGE, STRIDE = (
    0.35,
    64,
    1024,
    64,
)  # LaMa 上下文与输入约束。


def ellipse(radius):
    """构造奇数尺寸的椭圆形态学核。"""
    return cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)
    )


def fill_holes(mask):
    """填满封闭孔洞，保留外轮廓凹陷与连通外部的字间背景。"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    result = np.zeros_like(mask)
    cv2.drawContours(result, contours, -1, 255, cv2.FILLED)
    return result


def text_mask(image, selection, boxes):
    """暗笔画、邻近白描边、填孔和外扩使用固定规则，不按样本身份调参。"""
    x, y, w, h = cv2.boundingRect(selection)
    crop = image[y : y + h, x : x + w]
    selected = selection[y : y + h, x : x + w]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    white = (gray >= WHITE_MIN) & (
        np.ptp(crop.astype(np.int16), axis=2) <= WHITE_SPREAD
    )
    strokes = np.zeros_like(gray)
    for points in boxes:
        polygon = np.asarray(points, np.int32) - np.array([x, y], np.int32)
        box = np.zeros_like(gray)
        cv2.fillConvexPoly(box, polygon, 255)
        support = (box > 0) & (selected > 0)
        if np.count_nonzero(support) < 4:
            continue
        short = min(cv2.minAreaRect(polygon)[1])
        threshold, _ = cv2.threshold(
            gray[support].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        seeds = ((gray <= min(DARK_MAX, threshold)) & support).astype(np.uint8) * 255
        count, labels, stats, _ = cv2.connectedComponentsWithStats(seeds)
        minimum = max(2, round(short * short * COMPONENT_AREA_RATIO))
        keep = np.zeros_like(seeds)
        for label in range(1, count):
            if stats[label, cv2.CC_STAT_AREA] >= minimum:
                keep[labels == label] = 255
        nearby = cv2.dilate(keep, ellipse(max(1, round(short * HALO_RATIO)))) > 0
        ink = fill_holes(keep | ((nearby & white).astype(np.uint8) * 255))
        ink = cv2.dilate(ink, ellipse(max(1, round(short * EDGE_RATIO))))
        limit = cv2.dilate(box, ellipse(max(1, round(short * TEXT_PADDING_RATIO))))
        strokes |= ink & limit
    result = np.zeros_like(selection)
    result[y : y + h, x : x + w] = fill_holes(strokes) & selected
    if not np.any(result):
        raise ValueError("Empty repair mask")
    return result


def inpaint(image, mask, forward):
    """只返回掩码像素；各区域共用原图上下文，前一区域结果不参与后一区域推理。"""
    x, y, w, h = cv2.boundingRect(mask)
    margin = max(CONTEXT_MIN, round(max(w, h) * CONTEXT_RATIO))
    x0, y0 = max(0, x - margin), max(0, y - margin)
    x1, y1 = min(image.shape[1], x + w + margin), min(image.shape[0], y + h + margin)
    crop = image[y0:y1, x0:x1]
    submask = mask[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    scale = min(1.0, INPUT_EDGE / max(ch, cw))
    sh, sw = max(1, round(ch * scale)), max(1, round(cw * scale))
    ph, pw = (sh + STRIDE - 1) // STRIDE * STRIDE, (sw + STRIDE - 1) // STRIDE * STRIDE
    rgb = (
        cv2.resize(crop, (sw, sh), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(
            np.float32
        )
        / 255
    )
    scaled = (cv2.resize(submask, (sw, sh), interpolation=cv2.INTER_AREA) > 0).astype(
        np.float32
    )
    rgb = cv2.copyMakeBorder(rgb, 0, ph - sh, 0, pw - sw, cv2.BORDER_REFLECT)
    scaled = cv2.copyMakeBorder(scaled, 0, ph - sh, 0, pw - sw, cv2.BORDER_CONSTANT)
    tensor = np.concatenate([rgb.transpose(2, 0, 1), scaled[None]], axis=0)[None]
    output = forward(tensor)
    if output.shape != (1, 3, ph, pw):
        raise ValueError("Invalid inpaint output")
    restored = output[0].transpose(1, 2, 0)[:sh, :sw, ::-1]
    restored = cv2.resize(restored, (cw, ch), interpolation=cv2.INTER_LINEAR)
    return (restored[submask > 0] * 255).clip(0, 255).round().astype(np.uint8)
