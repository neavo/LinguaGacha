"""区域文字的笔画掩码与 LaMa 修复；排版选区始终只限定归属边界。"""

import cv2
import numpy as np

DARK_MAX, WHITE_MIN, WHITE_SPREAD = 150, 220, 30  # 深字上限与浅描边范围。
COMPONENT_AREA_RATIO = 0.0005  # 按文字框短边过滤孤立噪点。
HALO_RATIO, HALO_MAX = 0.12, 12  # 大字的描边搜索仍需贴近笔画。
SMALL_TEXT_MAX, SMALL_TEXT_EDGE, DEFAULT_EDGE = 16, 2, 3  # 小字附近常有紧贴的边线。
POLARITY_RING_RATIO, POLARITY_RING_MIN, POLARITY_RING_MAX = 0.25, 2, 8
POLARITY_PERCENTILE, POLARITY_CONTRAST_MARGIN, BACKGROUND_MIN_SAMPLES = 8, 12, 8
TAIL_ASPECT_MIN, TAIL_EXTENSION_RATIO, TAIL_EXTENSION_MIN, TAIL_EXTENSION_MAX = (
    1.2,
    0.45,
    3,
    24,
)
TAIL_CONNECTED_AREA_RATIO = 1.5  # 连通尾笔面积上限，防止沿画框线稿一路蔓延。
TAIL_DOT_AREA_RATIO, TAIL_DOT_SPAN_RATIO, TAIL_DOT_DISTANCE_RATIO = 0.15, 0.6, 0.35
TAIL_DOT_MIN_SPAN, TAIL_DOT_RING_RADIUS, TAIL_DOT_MIN_SAMPLES = 4, 2, 4
TAIL_DOT_BG_TOLERANCE, TAIL_DOT_BG_COVERAGE = 32, 0.8  # 小点周围应以本行底色为主。
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


def _is_light_line(ink, background, fallback):
    """比较框内两端亮度与框外背景的反差，区分同一区内的深字和浅字。"""
    if len(background) < BACKGROUND_MIN_SAMPLES:
        return fallback
    dark, bright = np.percentile(ink, [POLARITY_PERCENTILE, 100 - POLARITY_PERCENTILE])
    contrast = (bright + dark) - 2 * np.median(background)
    return contrast > 0 if abs(contrast) > POLARITY_CONTRAST_MARGIN else fallback


def _reading_extension_polygon(polygon, extension):
    """沿 OCR 框长边延伸两端，近方形框缺少可靠的阅读方向。"""
    points = polygon.astype(np.float32)
    e0, e1 = points[1] - points[0], points[3] - points[0]
    len0, len1 = float(np.linalg.norm(e0)), float(np.linalg.norm(e1))
    short, long = min(len0, len1), max(len0, len1)
    if short <= 0 or long < short * TAIL_ASPECT_MIN:
        return None
    extended = points.copy()
    if len0 >= len1:
        axis = e0 / len0 * extension
        extended[[0, 3]] -= axis
        extended[[1, 2]] += axis
    else:
        axis = e1 / len1 * extension
        extended[[0, 1]] -= axis
        extended[[2, 3]] += axis
    return np.rint(extended).astype(np.int32)


def _collect_reading_tail(crop, seeds, box, keep, ring, polygon, short, minimum):
    """补回框尾的连通笔画和底色一致的小标点。"""
    extension = min(
        TAIL_EXTENSION_MAX, max(TAIL_EXTENSION_MIN, round(short * TAIL_EXTENSION_RATIO))
    )
    extended_poly = _reading_extension_polygon(polygon, extension)
    accepted = np.zeros_like(box)
    if extended_poly is None:
        return accepted
    extended_box = np.zeros_like(box)
    cv2.fillConvexPoly(extended_box, extended_poly, 255)
    tail = seeds & (extended_box > 0) & (box == 0)
    if not np.any(tail):
        return accepted

    # 一次标记区分与框内笔画连通的成分和孤立小点。
    ink = keep | tail
    count, labels, stats, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8))
    touching = np.zeros(count, bool)
    touching[labels[keep]] = True
    tail_sizes = np.bincount(labels[tail], minlength=count)
    connected_max = max(minimum * 2, round(short * short * TAIL_CONNECTED_AREA_RATIO))
    accepted[tail & (touching & (tail_sizes <= connected_max))[labels]] = 255
    dot_area_max = max(minimum + 1, round(short * short * TAIL_DOT_AREA_RATIO))
    dots = np.flatnonzero(
        ~touching & (tail_sizes >= minimum) & (tail_sizes <= dot_area_max)
    )
    background = crop[ring]
    if not len(dots) or len(background) < BACKGROUND_MIN_SAMPLES:
        return accepted

    # 小点需要紧贴框尾，且周围大部分像素与本行底色接近。
    background_color = np.median(background, axis=0)
    span = max(TAIL_DOT_MIN_SPAN, round(short * TAIL_DOT_SPAN_RATIO))
    distance = max(TAIL_DOT_MIN_SPAN, round(short * TAIL_DOT_DISTANCE_RATIO))
    near_box = cv2.dilate(box, ellipse(distance)) > 0
    radius = TAIL_DOT_RING_RADIUS
    kernel = ellipse(radius)
    for label in dots:
        x, y, w, h, _ = stats[label]
        if max(w, h) > span:
            continue
        region = np.s_[
            max(0, y - radius) : y + h + radius, max(0, x - radius) : x + w + radius
        ]
        dot = labels[region] == label
        if not np.any(dot & near_box[region]):
            continue
        local_ring = (cv2.dilate(dot.astype(np.uint8), kernel) > 0) & ~ink[region]
        around = crop[region][local_ring]
        if len(around) >= TAIL_DOT_MIN_SAMPLES:
            matches = (
                np.max(np.abs(around - background_color), axis=1)
                <= TAIL_DOT_BG_TOLERANCE
            )
            if np.mean(matches) >= TAIL_DOT_BG_COVERAGE:
                accepted[region][dot] = 255
    return accepted


def text_mask(image, selection, boxes, origin, light_text=False):
    """按 OCR 行提取笔画和描边，无可修复笔画时返回 None。"""
    x, y, w, h = cv2.boundingRect(selection)
    crop = image[y : y + h, x : x + w]
    selected = selection[y : y + h, x : x + w]
    writable = selected > 0
    luma = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    inverted = 255 - luma
    neutral = np.ptp(crop, axis=2) <= WHITE_SPREAD  # 反相只改变亮度方向，通道跨度相同。
    strokes = np.zeros_like(luma)
    offset = np.array([origin[0] + x, origin[1] + y], np.int32)
    for points in boxes:
        polygon = np.asarray(points, np.int32) - offset
        box = np.zeros_like(luma)
        cv2.fillConvexPoly(box, polygon, 255)
        support = (box > 0) & writable
        if np.count_nonzero(support) < 4:
            continue
        short = min(cv2.minAreaRect(polygon)[1])
        ring_radius = min(
            POLARITY_RING_MAX,
            max(POLARITY_RING_MIN, round(short * POLARITY_RING_RATIO)),
        )
        ring = (cv2.dilate(box, ellipse(ring_radius)) > 0) & (box == 0)
        is_light = _is_light_line(luma[support], luma[ring], light_text)
        gray = inverted if is_light else luma  # 阈值与描边规则统一按深色笔画处理。
        threshold, _ = cv2.threshold(
            gray[support].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        seeds = (gray <= min(DARK_MAX, threshold)) & writable
        _, labels, stats, _ = cv2.connectedComponentsWithStats(
            (seeds & support).astype(np.uint8)
        )
        minimum = max(2, round(short * short * COMPONENT_AREA_RATIO))
        valid = stats[:, cv2.CC_STAT_AREA] >= minimum
        valid[0] = False
        keep = valid[labels]
        if not np.any(keep):
            continue
        tail = _collect_reading_tail(
            crop, seeds, box, keep, ring, polygon, short, minimum
        )
        ink = (keep.astype(np.uint8) * 255) | tail
        halo_radius = min(HALO_MAX, max(1, round(short * HALO_RATIO)))
        nearby = cv2.dilate(ink, ellipse(halo_radius)) > 0
        ink[nearby & neutral & (gray >= WHITE_MIN)] = 255
        edge_radius = SMALL_TEXT_EDGE if short <= SMALL_TEXT_MAX else DEFAULT_EDGE
        # 先闭合抗锯齿边缘，再填字形内部的孔洞，最后裁掉框外背景。
        ink = fill_holes(cv2.dilate(ink, ellipse(edge_radius)))
        limit = cv2.dilate(box | tail, ellipse(edge_radius + 1))
        strokes |= ink & limit
    strokes = fill_holes(strokes) & selected
    if not np.any(strokes):
        return None
    result = np.zeros_like(selection)
    result[y : y + h, x : x + w] = strokes
    return result


def inpaint(image, mask, origin, forward):
    """按局部掩码的原图坐标取上下文，返回掩码内像素。"""
    left, top = origin
    mx, my, w, h = cv2.boundingRect(mask)
    x, y = left + mx, top + my
    margin = max(CONTEXT_MIN, round(max(w, h) * CONTEXT_RATIO))
    x0, y0 = max(0, x - margin), max(0, y - margin)
    x1, y1 = min(image.shape[1], x + w + margin), min(image.shape[0], y + h + margin)
    crop = image[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    submask = np.zeros((ch, cw), np.uint8)
    dx, dy = x - x0, y - y0
    submask[dy : dy + h, dx : dx + w] = mask[my : my + h, mx : mx + w]
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
