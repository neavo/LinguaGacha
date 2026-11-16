"""按页把区域原图与消字候选排成有界拼图。"""
import math
from pathlib import Path

import cv2
import numpy as np

MAX_EDGE = 1280
GAP = 12
HEADER = 26
PANEL_HEIGHT = 420  # 为每行标签与页间距留出空间。
MAX_SCALE = 2.0  # 限制低分辨率裁图的放大。


def _read(path):
    """以 Unicode 路径读取候选裁图。"""
    image = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Invalid candidate image: {path}")
    return image


def _panel(image, label, width):
    """等比缩放并在图外添加候选编号。"""
    scale = min(width / image.shape[1], PANEL_HEIGHT / image.shape[0], MAX_SCALE)
    resized = cv2.resize(
        image,
        (max(1, round(image.shape[1] * scale)), max(1, round(image.shape[0] * scale))),
        interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
    )
    panel = np.full((resized.shape[0] + HEADER, resized.shape[1], 3), 255, np.uint8)
    panel[HEADER:] = resized
    cv2.putText(panel, label, (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 1, cv2.LINE_AA)
    return panel


def candidate_sheets(regions, output):
    """保持区域内缩放一致，将长横条连续分段后按页装箱。"""
    rows = []
    for region in regions:
        entries = [("O", region["originalCrop"])] + [
            (candidate["candidateId"], candidate["crop"])
            for candidate in region["candidates"]
        ]
        images = [(label, _read(file)) for label, file in entries]
        height, width = images[0][1].shape[:2]
        parts = max(1, math.ceil(width / max(1, height * 3)))
        panel_width = max(64, (MAX_EDGE - GAP * (len(images) + 1)) // len(images))
        for part in range(parts):
            x0, x1 = round(width * part / parts), round(width * (part + 1) / parts)
            suffix = f" {part + 1}/{parts}" if parts > 1 else ""
            panels = [
                _panel(image[:, x0:x1], f"{region['regionId']} {label}{suffix}", panel_width)
                for label, image in images
            ]
            row_height = max(panel.shape[0] for panel in panels)
            row_width = sum(panel.shape[1] for panel in panels) + GAP * (len(panels) + 1)
            row = np.full((row_height + GAP * 2, row_width, 3), 242, np.uint8)
            x = GAP
            for panel in panels:
                row[GAP:GAP + panel.shape[0], x:x + panel.shape[1]] = panel
                x += panel.shape[1] + GAP
            rows.append(row)

    sheets, current = [], []
    height = GAP
    for row in rows:
        if current and height + row.shape[0] + GAP > MAX_EDGE:
            sheets.append(current)
            current, height = [], GAP
        current.append(row)
        height += row.shape[0] + GAP
    if current:
        sheets.append(current)

    paths = []
    root = Path(output)
    for index, sheet_rows in enumerate(sheets, 1):
        width = max(row.shape[1] for row in sheet_rows)
        height = sum(row.shape[0] for row in sheet_rows) + GAP * (len(sheet_rows) + 1)
        sheet = np.full((height, width, 3), 255, np.uint8)
        y = GAP
        for row in sheet_rows:
            sheet[y:y + row.shape[0], :row.shape[1]] = row
            y += row.shape[0] + GAP
        root.mkdir(parents=True, exist_ok=True)
        file = root / f"candidates-{index:03d}.png"
        ok, data = cv2.imencode(".png", sheet)
        if not ok:
            raise ValueError("Candidate sheet encoding failed")
        data.tofile(str(file))
        paths.append(str(file.resolve()))
    return paths
