"""图片与媒体共用的 PP-OCRv6-Manga 前后处理。

DB 后处理来自 RapidOCR 3.10.0 `ch_ppocr_det/utils.py`（Apache-2.0），按需懒加载
`cv2` 与 `pyclipper`，避免媒体纯音频命令在未装视觉依赖的环境提前失败。
"""

import math

import numpy as np

_IMAGE_SIDE = 1280  # 单页检测优先召回。
_MEDIA_SIDE = 640  # 连续视频采样优先吞吐。
_DETECTION_MEAN = np.array([0.485, 0.456, 0.406], np.float32)  # Manga 模型归一化。
_DETECTION_STD = np.array([0.229, 0.224, 0.225], np.float32)
_DETECTION_MIN_SIZE = 3  # DB 候选短边下限。
_DETECTION_CANDIDATES = 1000  # 单张概率图最多处理的轮廓数。
# 图片每页一次追求召回；媒体持续采样优先限制纹理误检与吞吐。
_IMAGE_THRESHOLD, _IMAGE_BOX_THRESHOLD, _IMAGE_UNCLIP = 0.15, 0.25, 1.4
_MEDIA_THRESHOLD, _MEDIA_BOX_THRESHOLD, _MEDIA_UNCLIP = 0.3, 0.5, 1.6
_RECOGNITION_HEIGHT = 48  # Manga 识别模型固定输入高度。


def _detection_input(image, ratio):
    """按模型步长缩放并执行 ImageNet 归一化。"""
    import cv2

    height, width = image.shape[:2]
    target_h = max(32, int(round(height * ratio / 32) * 32))
    target_w = max(32, int(round(width * ratio / 32) * 32))
    resized = cv2.resize(image, (target_w, target_h)).astype(np.float32) / 255
    normalized = (resized - _DETECTION_MEAN) / _DETECTION_STD
    return np.ascontiguousarray(normalized.transpose(2, 0, 1)[None])


def image_detection_input(image):
    """按页面比例控制 1280 像素预算；超长页面不放大。"""
    height, width = image.shape[:2]
    if max(height, width) / min(height, width) > 2:
        ratio = min(1.0, math.sqrt(0.75 * _IMAGE_SIDE * _IMAGE_SIDE / (height * width)))
    else:
        ratio = _IMAGE_SIDE / max(height, width)
    return _detection_input(image, ratio)


def media_detection_input(frame):
    """视频帧长边不超过 640 像素，不放大小画面。"""
    height, width = frame.shape[:2]
    return _detection_input(frame, min(1.0, _MEDIA_SIDE / max(height, width)))


def _mini_box(contour):
    """最小外接矩形的四点（左上起顺时针）与短边长。"""
    import cv2

    rect = cv2.minAreaRect(contour)
    points = sorted(cv2.boxPoints(rect).tolist(), key=lambda point: point[0])
    left = sorted(points[:2], key=lambda point: point[1])
    right = sorted(points[2:], key=lambda point: point[1])
    return np.array([left[0], right[0], right[1], left[1]], np.float32), min(rect[1])


def _clockwise(points):
    """按 x 分左右两对，各自按 y 排出左上、右上、右下、左下。"""
    ordered = points[np.argsort(points[:, 0], kind="stable")]
    left = ordered[:2][np.argsort(ordered[:2, 1], kind="stable")]
    right = ordered[2:][np.argsort(ordered[2:, 1], kind="stable")]
    return np.array([left[0], right[0], right[1], left[1]], np.float32)


def _sort_boxes(boxes):
    """从上到下、同一行从左到右。左上角 y 相差不足 10 像素视为同一行。"""
    if not boxes:
        return boxes
    by_y = sorted(boxes, key=lambda box: box[0, 1])
    lines = np.concatenate([[0], np.cumsum(np.diff([box[0, 1] for box in by_y]) >= 10)])
    return [by_y[i] for i in np.lexsort(([box[0, 0] for box in by_y], lines))]


def _detection_records(
    prediction,
    height,
    width,
    *,
    threshold,
    box_threshold,
    unclip_ratio,
):
    """DB 后处理同时保留文字主体框与外扩框。"""
    import cv2
    import pyclipper

    bitmap = cv2.dilate(
        (prediction > threshold).astype(np.uint8), np.ones((2, 2), np.uint8)
    )
    contours, _ = cv2.findContours(bitmap * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    map_h, map_w = prediction.shape
    records = []
    for contour in contours[:_DETECTION_CANDIDATES]:
        points, side = _mini_box(contour)
        if side < _DETECTION_MIN_SIZE:
            continue
        x0, x1 = np.clip(
            [math.floor(points[:, 0].min()), math.ceil(points[:, 0].max())],
            0,
            map_w - 1,
        )
        y0, y1 = np.clip(
            [math.floor(points[:, 1].min()), math.ceil(points[:, 1].max())],
            0,
            map_h - 1,
        )
        mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
        cv2.fillPoly(mask, (points - [x0, y0]).reshape(1, -1, 2).astype(np.int32), 1)
        score = cv2.mean(prediction[y0 : y1 + 1, x0 : x1 + 1], mask)[0]
        if score < box_threshold:
            continue
        perimeter = cv2.arcLength(points, True)
        if perimeter <= 0:
            continue
        distance = cv2.contourArea(points) * unclip_ratio / perimeter
        offset = pyclipper.PyclipperOffset()
        offset.AddPath(points.tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
        executed = offset.Execute(distance)
        if not executed:
            continue
        largest = max(
            executed, key=lambda path: cv2.contourArea(np.array(path, np.float32))
        )
        expanded, side = _mini_box(np.array(largest, np.float32).reshape(-1, 1, 2))
        if side < _DETECTION_MIN_SIZE + 2:
            continue

        def project(source):
            """把检测图坐标投影回来源图，并保持顺时针点序。"""
            box = np.empty_like(source)
            box[:, 0] = np.clip(np.round(source[:, 0] / map_w * width), 0, width - 1)
            box[:, 1] = np.clip(np.round(source[:, 1] / map_h * height), 0, height - 1)
            return _clockwise(box)

        box = project(expanded)
        core_box = project(points)
        edge_w = np.linalg.norm(box[0] - box[1])
        edge_h = np.linalg.norm(box[0] - box[3])
        if int(edge_w) > _DETECTION_MIN_SIZE and int(edge_h) > _DETECTION_MIN_SIZE:
            records.append(dict(box=box, coreBox=core_box, score=float(score)))
    ordered = _sort_boxes([record["box"] for record in records])
    by_box = {record["box"].tobytes(): record for record in records}
    return [by_box[box.tobytes()] for box in ordered]


def image_detection_records(prediction, height, width):
    """图片检测保留低阈值的主体框与外扩框。"""
    return _detection_records(
        prediction,
        height,
        width,
        threshold=_IMAGE_THRESHOLD,
        box_threshold=_IMAGE_BOX_THRESHOLD,
        unclip_ratio=_IMAGE_UNCLIP,
    )


def media_detection_boxes(prediction, height, width):
    """媒体检测使用高阈值，只返回区间分组消费的外扩框。"""
    return [
        record["box"]
        for record in _detection_records(
            prediction,
            height,
            width,
            threshold=_MEDIA_THRESHOLD,
            box_threshold=_MEDIA_BOX_THRESHOLD,
            unclip_ratio=_MEDIA_UNCLIP,
        )
    ]


def recognition_input(image):
    """把已水平放置的文字裁图缩放为 Manga 动态宽度识别输入。"""
    import cv2

    height, width = image.shape[:2]
    target_width = max(16, round(_RECOGNITION_HEIGHT * width / height))
    resized = cv2.resize(image, (target_width, _RECOGNITION_HEIGHT)).astype(np.float32)
    return np.ascontiguousarray(((resized / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None])
