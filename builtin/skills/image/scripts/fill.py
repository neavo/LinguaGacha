"""最终二值选区的内缩、背景分析和并集填色。颜色接口使用 RGB，像素使用 BGR。"""

import math

import cv2
import numpy as np

INSET_RATIO, INSET_MIN, INSET_MAX = 0.008, 2, 6
COLOR_BIN, COLOR_DISTANCE, FILL_COVERAGE = 8, 12, 0.80
TRANSITION_WIDTH = 1.0
TRANSITION_DISTANCE = 0.5 + TRANSITION_WIDTH
CONTEXT_BORDER = math.ceil(TRANSITION_DISTANCE)


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
    """从选区的非文字像素确定填色可行性和背景色。"""
    pixels = image[(selection > 0) & (text_mask == 0)].astype(np.int16)
    if not len(pixels):
        # 无背景样本时仍需估计绘字用色，消字走模型。
        pixels = image[selection > 0]
        if not len(pixels):
            raise ValueError("Empty region selection")
        return False, np.median(pixels, axis=0).round().astype(np.uint8)[::-1].tolist()
    _, inverse, counts = np.unique(
        pixels // COLOR_BIN, axis=0, return_inverse=True, return_counts=True
    )
    seed = np.median(pixels[inverse == np.argmax(counts)], axis=0)
    nearby = pixels[np.max(np.abs(pixels - seed), axis=1) <= COLOR_DISTANCE]
    color = np.median(nearby, axis=0).round().astype(np.uint8)
    coverage = float(np.mean(np.max(np.abs(pixels - color), axis=1) <= COLOR_DISTANCE))
    return coverage >= FILL_COVERAGE, color[::-1].tolist()


def render_fill(image, mask, color):
    """填充同一背景色，在选区外缘向内混合一次。"""
    result = image.copy()
    selected = mask > 0
    result[selected] = color[::-1]
    # 调用方保留选区外的过渡范围。真实页边沿用图内距离，不产生额外透明带。
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    edge = selected & (distance < TRANSITION_DISTANCE)
    alpha = np.clip((distance[edge] - 0.5) / TRANSITION_WIDTH, 0, 1)[:, None]
    result[edge] = np.floor(
        image[edge] * (1 - alpha) + result[edge] * alpha + 0.5
    ).astype(np.uint8)
    return result
