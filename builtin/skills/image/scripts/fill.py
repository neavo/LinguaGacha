"""二值选区内缩、背景形态判定与纯色平滑填充。

像素数组使用 OpenCV 通道序（3 通道 BGR 或 4 通道 BGRA），返回的绘字参考色为 3 通道 RGB。
"""

import math

import cv2
import numpy as np

INSET_RATIO, INSET_MIN, INSET_MAX = 0.008, 2, 6
COLOR_BIN, COLOR_DISTANCE, FILL_COVERAGE = 8, 12, 0.80
TRANSPARENT_ALPHA_MAX, VISIBLE_TEXT_ALPHA = 16, 32
TRANSITION_WIDTH = 1.0
TRANSITION_DISTANCE = 0.5 + TRANSITION_WIDTH
CONTEXT_BORDER = math.ceil(TRANSITION_DISTANCE)


def inset_selection(mask):
    """填充外轮廓内部孔洞并向内收缩，避免内部文字或装饰在选区中留下空洞。"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
    _, _, w, h = cv2.boundingRect(filled)
    inset = max(INSET_MIN, min(INSET_MAX, round(min(w, h) * INSET_RATIO)))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * inset + 1, 2 * inset + 1)
    )
    return cv2.erode(filled, kernel, iterations=1)


def _median_color(pixels):
    return np.median(pixels, axis=0).round().astype(np.uint8)


def median_luma(pixels):
    """计算 BGR 像素样本的中位灰度亮度（0–255）。"""
    return np.median(cv2.cvtColor(pixels.reshape(-1, 1, 3), cv2.COLOR_BGR2GRAY))


def _text_background_color(image, selected, text_mask, fallback):
    """按可见原文字亮度反推绘字参考背景色，使透明或半透明底上的译字沿用原明暗倾向。"""
    visible = selected & (image[:, :, 3] > VISIBLE_TEXT_ALPHA)
    ink = image[:, :, :3][visible & (text_mask > 0)]
    if not len(ink):
        ink = image[:, :, :3][visible]
    if not len(ink):
        return fallback
    return [0, 0, 0] if median_luma(ink) >= 128 else [255, 255, 255]


def _cluster_background(pixels):
    """在主色分箱邻域内统计覆盖率，判断背景是否可视为纯色。"""
    pixels = pixels.astype(np.int16)
    _, inverse, counts = np.unique(
        pixels // COLOR_BIN, axis=0, return_inverse=True, return_counts=True
    )
    seed = np.median(pixels[inverse == np.argmax(counts)], axis=0)
    nearby = pixels[np.max(np.abs(pixels - seed), axis=1) <= COLOR_DISTANCE]
    color = _median_color(nearby)
    coverage = float(np.mean(np.max(np.abs(pixels - color), axis=1) <= COLOR_DISTANCE))
    return coverage >= FILL_COVERAGE, color


def analyze_background(image, selection, text_mask):
    """判定选区背景形态并返回 `(mode, background_rgb, target_pixel, opaque_only)`。

    - 3 通道不透明图：直接按主色聚簇在 `fill` 与 `lama` 间分流。
    - 4 通道透明图：先识别全透明底（`transparent`）与实底占优区（`opaque_only=True`，只改写不透明像素）；
      其余半透明背景按 4 通道聚簇，并按原字亮度反推绘字参考色，避免脱离底层画面误判明暗。
    """
    selected = selection > 0
    background = image[selected & (text_mask == 0)]
    if not len(background):
        target = _median_color(image[selected])
        return "lama", target[:3][::-1].tolist(), target, False

    opaque_only = False
    if image.shape[2] == 4:
        alpha = background[:, 3]
        if np.mean(alpha <= TRANSPARENT_ALPHA_MAX) >= FILL_COVERAGE:
            return (
                "transparent",
                _text_background_color(image, selected, text_mask, [255, 255, 255]),
                None,
                False,
            )
        opaque = alpha == 255
        opaque_only = np.mean(opaque) >= FILL_COVERAGE
        if opaque_only:
            background = background[opaque]

    use_fill, target = _cluster_background(background)
    if not use_fill and image.shape[2] == 4:
        target[3] = np.median(background[:, 3]).round()
    rgb = target[:3][::-1].tolist()
    if image.shape[2] == 4 and not opaque_only:
        rgb = _text_background_color(image, selected, text_mask, rgb)
    return "fill" if use_fill else "lama", rgb, target, opaque_only


def render_fill(image, mask, color):
    """向选区填充纯色（BGR 或 BGRA），并在选区外缘向内平滑混合 1 像素。"""
    result = image.copy()
    selected = mask > 0
    result[selected] = color
    # 调用方在选区外预留 CONTEXT_BORDER；贴近画布边沿时沿图内距离渐变，不产生额外透明带。
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    edge = selected & (distance < TRANSITION_DISTANCE)
    alpha = np.clip((distance[edge] - 0.5) / TRANSITION_WIDTH, 0, 1)[:, None]
    result[edge] = np.floor(
        image[edge] * (1 - alpha) + result[edge] * alpha + 0.5
    ).astype(np.uint8)
    return result
