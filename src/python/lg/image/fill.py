"""最终二值选区的内缩、背景分析和并集填色。颜色接口使用 RGB，像素使用 BGR。"""

import cv2
import numpy as np

INSET_RATIO, INSET_MIN, INSET_MAX = 0.008, 2, 6
COLOR_BIN, COLOR_DISTANCE, FILL_COVERAGE = 8, 12, 0.80
TRANSITION_WIDTH = 1.0


def inset_selection(mask):
    """外轮廓填孔后内缩，内部文字和装饰不再形成保留孔洞。"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
    _, _, w, h = cv2.boundingRect(filled)
    inset = max(INSET_MIN, min(INSET_MAX, round(min(w, h) * INSET_RATIO)))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * inset + 1, 2 * inset + 1)
    )
    return cv2.erode(filled, kernel, iterations=1)


def analyze_background(image, selection, text_mask):
    """从最终归属中排除文字框，同一份统计决定建议颜色和分流。"""
    pixels = image[(selection > 0) & (text_mask == 0)].astype(np.int16)
    background = dict(route="model", coverage=None, samplePixels=len(pixels))
    if not len(pixels):
        return background, None
    _, inverse, counts = np.unique(
        pixels // COLOR_BIN, axis=0, return_inverse=True, return_counts=True
    )
    seed = np.median(pixels[inverse == np.argmax(counts)], axis=0)
    nearby = pixels[np.max(np.abs(pixels - seed), axis=1) <= COLOR_DISTANCE]
    color = np.median(nearby, axis=0).round().astype(np.uint8)
    coverage = float(np.mean(np.max(np.abs(pixels - color), axis=1) <= COLOR_DISTANCE))
    background.update(
        route="fill" if coverage >= FILL_COVERAGE else "model", coverage=coverage
    )
    return background, color[::-1].tolist()


def render_fill(image, selections):
    """逐项消费选区与 RGB 色值，只在填色并集外缘向内混合一次。"""
    result = image.copy()
    union = np.zeros(image.shape[:2], np.uint8)
    for mask, color in selections:
        result[mask > 0] = color[::-1]
        union |= mask
    if not np.any(union):
        return result
    # 不补图外零边；触页边不产生额外透明带，全页选区直接完整填色。
    distance = cv2.distanceTransform(union, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    edge = (union > 0) & (distance < 0.5 + TRANSITION_WIDTH)
    alpha = np.clip((distance[edge] - 0.5) / TRANSITION_WIDTH, 0, 1)[:, None]
    result[edge] = np.floor(
        image[edge] * (1 - alpha) + result[edge] * alpha + 0.5
    ).astype(np.uint8)
    return result
