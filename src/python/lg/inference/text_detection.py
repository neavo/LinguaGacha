"""跨领域共用的 PP-OCRv6 DB 文字检测前后处理。

来自 RapidOCR 3.10.0 `ch_ppocr_det/utils.py`（Apache-2.0），按需在函数内懒加载
`cv2` 与 `pyclipper`，避免媒体纯音频命令在未装视觉依赖的环境提前失败。
"""

import math

import numpy as np

DET_SIDE = 640
DET_THRESH, DET_BOX_THRESH, DET_UNCLIP, DET_MIN_SIZE, DET_CANDIDATES = 0.3, 0.5, 1.6, 3, 1000


def det_input(frame, side=DET_SIDE, upscale=False, interpolation=None):
    """缩放到目标边长且对齐 32 的倍数，归一化为 [1, 3, H, W]。"""
    import cv2

    height, width = frame.shape[:2]
    ratio = max(1.0, side / max(height, width)) if upscale else min(1.0, side / max(height, width))
    target_w = max(32, int(round(int(width * ratio) / 32) * 32))
    target_h = max(32, int(round(int(height * ratio) / 32) * 32))
    method = interpolation if interpolation is not None else (cv2.INTER_CUBIC if ratio > 1.0 else cv2.INTER_LINEAR)
    image = cv2.resize(frame, (target_w, target_h), interpolation=method).astype(np.float32) / 127.5 - 1
    return image.transpose(2, 0, 1)[None]


def mini_box(contour):
    """最小外接矩形的四点（左上起顺时针）与短边长。"""
    import cv2

    rect = cv2.minAreaRect(contour)
    points = sorted(cv2.boxPoints(rect).tolist(), key=lambda point: point[0])
    left = sorted(points[:2], key=lambda point: point[1])
    right = sorted(points[2:], key=lambda point: point[1])
    return np.array([left[0], right[0], right[1], left[1]], np.float32), min(rect[1])


def clockwise(points):
    """按 x 分左右两对，各自按 y 排出左上、右上、右下、左下。"""
    ordered = points[np.argsort(points[:, 0], kind="stable")]
    left = ordered[:2][np.argsort(ordered[:2, 1], kind="stable")]
    right = ordered[2:][np.argsort(ordered[2:, 1], kind="stable")]
    return np.array([left[0], right[0], right[1], left[1]], np.float32)


def sort_boxes(boxes):
    """从上到下、同一行从左到右。左上角 y 相差不足 10 像素视为同一行。"""
    if not boxes:
        return boxes
    by_y = sorted(boxes, key=lambda box: box[0, 1])
    lines = np.concatenate([[0], np.cumsum(np.diff([box[0, 1] for box in by_y]) >= 10)])
    return [by_y[i] for i in np.lexsort(([box[0, 0] for box in by_y], lines))]


def det_box_records(pred, height, width, round_coords=True):
    """DB 后处理同时保留文字主体框与外扩框。"""
    import cv2
    import pyclipper

    bitmap = cv2.dilate((pred > DET_THRESH).astype(np.uint8), np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(bitmap * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    map_h, map_w = pred.shape
    records = []
    for contour in contours[:DET_CANDIDATES]:
        points, side = mini_box(contour)
        if side < DET_MIN_SIZE:
            continue
        x0, x1 = np.clip([math.floor(points[:, 0].min()), math.ceil(points[:, 0].max())], 0, map_w - 1)
        y0, y1 = np.clip([math.floor(points[:, 1].min()), math.ceil(points[:, 1].max())], 0, map_h - 1)
        mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
        cv2.fillPoly(mask, (points - [x0, y0]).reshape(1, -1, 2).astype(np.int32), 1)
        score = cv2.mean(pred[y0 : y1 + 1, x0 : x1 + 1], mask)[0]
        if score < DET_BOX_THRESH:
            continue
        perimeter = cv2.arcLength(points, True)
        if perimeter <= 0:
            continue
        distance = cv2.contourArea(points) * DET_UNCLIP / perimeter
        offset = pyclipper.PyclipperOffset()
        offset.AddPath(points.tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
        executed = offset.Execute(distance)
        if not executed:
            continue
        largest = max(executed, key=lambda path: cv2.contourArea(np.array(path, np.float32)))
        expanded, side = mini_box(np.array(largest, np.float32).reshape(-1, 1, 2))
        if side < DET_MIN_SIZE + 2:
            continue
        def project(source):
            """把检测图坐标投影回来源图，并保持顺时针点序。"""
            box = np.empty_like(source)
            if round_coords:
                box[:, 0] = np.clip(np.round(source[:, 0] / map_w * width), 0, width - 1)
                box[:, 1] = np.clip(np.round(source[:, 1] / map_h * height), 0, height - 1)
            else:
                box[:, 0] = np.clip(source[:, 0] / map_w * width, 0.0, float(width))
                box[:, 1] = np.clip(source[:, 1] / map_h * height, 0.0, float(height))
            return clockwise(box)

        box = project(expanded)
        core_box = project(points)
        edge_w = np.linalg.norm(box[0] - box[1])
        edge_h = np.linalg.norm(box[0] - box[3])
        valid = (int(edge_w) > DET_MIN_SIZE and int(edge_h) > DET_MIN_SIZE) if round_coords else (edge_w > DET_MIN_SIZE and edge_h > DET_MIN_SIZE)
        if valid:
            records.append(dict(box=box, coreBox=core_box, score=float(score)))
    ordered = sort_boxes([record["box"] for record in records])
    by_box = {record["box"].tobytes(): record for record in records}
    return [by_box[box.tobytes()] for box in ordered]


def det_boxes(pred, height, width, round_coords=True):
    """媒体识别只消费外扩框。"""
    return [record["box"] for record in det_box_records(pred, height, width, round_coords)]
