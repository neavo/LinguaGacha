"""画面文字的本地检测、图集与边界校准。

由 media.mjs 通过 `uv run python text.py <命令> <任务 JSON> <结果 JSON>` 调用。
只检测位置，文字内容由 Agent 看图识别。
"""

import json
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import cache
from pathlib import Path

import cv2
import numpy as np
from rapidocr import RapidOCR

MAX_EDGE = 1920  # 解码长边上限，不放大。也是裁图的分辨率。
DET_SIDE = 640  # 检测内部长边，按文字召回与耗时实测选定。
# 合并多行文字前过滤误框成整幅画面的纹理，正常多行块仍可合并。
MAX_BOX_HEIGHT = 0.5
WORKERS = 2  # 检测实例数，限制与 ASR 同时运行时的 CPU 占用。
WORKER_THREADS = 4  # 每个实例的 onnxruntime 线程数。
PREFETCH = 8  # 已解码待检测的帧数上限，避免整片读入内存。
LINE_GAP = 0.6  # 行间距小于较矮一行高度的该倍数时视为同一块（经验值），两行硬字幕合成一块。
TRACK_IOU = 0.5  # 相邻帧的块交并比不低于该值时归入同一区间（经验值）。
GAP_FRAMES = 1  # 区间允许连续漏检的帧数，弥补 640 检测偶尔的漏判。
CROP_MARGIN = 0.3  # 裁图四周留出块高的该倍数。
JPEG_QUALITY = 90
SHEET_EDGE = 1280  # 图集边长。画布越大，送进模型前被服务商缩小得越多，同一张裁图反而更模糊。
SHEET_CROP_HEIGHT = 160  # 裁图在图集中的最大高度。
SHEET_LABEL_HEIGHT = 24  # 裁图上方标签行的高度。
SHEET_GAP = 8  # 图集中裁图的间距。
LABEL_FONT, LABEL_SCALE, LABEL_THICKNESS = cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
REFINE_FPS = 8  # 边界校准的检测帧率。
REFINE_WINDOW = 1  # 边界前后各取的秒数，覆盖 1 fps 区间的起止误差。
REFINE_IOU = 0.3  # 校准时块与条目 `box` 的交并比下限。高帧率下淡入淡出的块更小，阈值放宽。

cv2.setNumThreads(1)  # 并发由检测实例数控制，OpenCV 再开线程只会争抢 CPU。


def frame_size(width, height):
    """解码尺寸：长边不超过 MAX_EDGE，保持比例，不放大。"""
    scale = min(1, MAX_EDGE / max(width, height))
    return round(width * scale), round(height * scale)


def decode(ffmpeg, source, size, fps, start=None, duration=None):
    """按固定帧率逐帧产出 BGR 画面。`start_time=0` 使第 i 帧正好是第 i/fps 秒，与音频零点一致。"""
    width, height = size
    args = [ffmpeg, "-hide_banner", "-nostdin", "-v", "error"]
    if start is not None:
        args += ["-ss", str(start), "-t", str(duration)]
    args += [
        "-i", source, "-map", "0:V:0", "-an", "-sn",
        "-vf", f"fps={fps}:start_time=0,scale={width}:{height}",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ]  # fmt: skip
    process = subprocess.Popen(args, stdout=subprocess.PIPE)  # 诊断信息直接进日志。
    frame_bytes = width * height * 3
    try:
        while len(data := process.stdout.read(frame_bytes)) == frame_bytes:
            yield np.frombuffer(data, np.uint8).reshape(height, width, 3)
        if process.wait() != 0:
            raise RuntimeError(f"ffmpeg 解码失败 ({process.returncode})")
    finally:
        if process.poll() is None:  # 消费者提前停止或出错。
            process.kill()
            process.wait()
        process.stdout.close()


def detector(model):
    """每个线程持有独立实例，onnxruntime 会话不跨线程共享。"""
    local = threading.local()

    def detect(frame):
        """按需加载线程独占的检测器，再过滤巨框并合并文字行。"""
        if not hasattr(local, "engine"):
            local.engine = RapidOCR(
                params={
                    "Global.use_det": True,
                    "Global.use_cls": False,
                    "Global.use_rec": False,
                    "Global.log_level": "error",
                    "Det.model_path": model,
                    "Det.limit_side_len": DET_SIDE,
                    "Det.limit_type": "max",
                    "EngineConfig.onnxruntime.intra_op_num_threads": WORKER_THREADS,
                    "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                }
            )
        boxes = local.engine(frame, use_det=True, use_cls=False, use_rec=False).boxes
        limit = MAX_BOX_HEIGHT * frame.shape[0]
        return blocks([box for box in ([] if boxes is None else boxes) if np.ptp(box[:, 1]) <= limit])

    return detect


def blocks(boxes):
    """把检测框转成轴对齐矩形，上下相邻且水平重叠的合成一块。"""
    rects = [
        [float(box[:, 0].min()), float(box[:, 1].min()), float(box[:, 0].max()), float(box[:, 1].max())]
        for box in map(np.asarray, boxes)
    ]
    merged = True
    while merged:
        merged = False
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a, b = rects[i], rects[j]
                gap = max(a[1], b[1]) - min(a[3], b[3])  # 负数表示上下重叠。
                if min(a[2], b[2]) > max(a[0], b[0]) and gap < LINE_GAP * min(a[3] - a[1], b[3] - b[1]):
                    rects[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del rects[j]
                    merged = True
                    break
            if merged:
                break
    return rects


def area(rect):
    """轴对齐矩形的面积，分离的交集按零计算。"""
    return max(0.0, rect[2] - rect[0]) * max(0.0, rect[3] - rect[1])


def iou(a, b):
    """矩形交并比，空矩形之间不匹配。"""
    inner = area([max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])])
    return inner / (area(a) + area(b) - inner or 1)


def crop(frame, rect, file):
    """按块裁图，四周留出块高的边距。"""
    height, width = frame.shape[:2]
    margin = CROP_MARGIN * (rect[3] - rect[1])
    x0, y0 = max(0, int(rect[0] - margin)), max(0, int(rect[1] - margin))
    x1, y1 = min(width, int(rect[2] + margin + 1)), min(height, int(rect[3] + margin + 1))
    if not cv2.imwrite(str(file), frame[y0:y1, x0:x1], [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]):
        raise OSError(f"无法写入裁图 {file}")  # OpenCV 写入失败也可能只返回 False。


def scan(ffmpeg, source, model, width, height, out):
    """1 fps 检测整片，按位置把块串成区间，每个区间保存文字框最大那一帧的裁图。

    `start` 是首次检测到的秒数，`end` 是最后一次检测到的秒数加 1，`box` 是各帧块的归一化并集。
    每秒抽帧，覆盖出现在镜头中途的短文字。
    """
    size = frame_size(width, height)
    crops = Path(out, "text")
    crops.mkdir(parents=True, exist_ok=True)
    regions, active = [], []  # 全部区间；还能延续的区间。
    detect = detector(model)
    with ThreadPoolExecutor(WORKERS) as executor:
        # Python 3.14 的有界 map 保持帧顺序，避免整片画面驻留内存。
        frames = executor.map(lambda frame: (frame, detect(frame)), decode(ffmpeg, source, size, 1), buffersize=PREFETCH)
        for second, (frame, found) in enumerate(frames):
            active = [region for region in active if second - region["last"] <= GAP_FRAMES + 1]
            taken = set()  # 同一帧的两个块不能归入同一区间。
            for rect in found:
                match = max(
                    (region for region in active if region["id"] not in taken),
                    key=lambda region: iou(rect, region["rect"]),
                    default=None,
                )
                if match is None or iou(rect, match["rect"]) < TRACK_IOU:
                    match = {"id": len(regions), "start": second, "box": rect, "size": -1}
                    regions.append(match)
                    active.append(match)
                taken.add(match["id"])
                box = match["box"]
                match.update(
                    last=second,
                    rect=rect,
                    box=[min(box[0], rect[0]), min(box[1], rect[1]), max(box[2], rect[2]), max(box[3], rect[3])],
                )
                if area(rect) > match["size"]:  # 招牌经过镜头时，最大最清楚的一帧更有价值。
                    match.update(size=area(rect), at=second)
                    crop(frame, rect, crops / f"{match['id']}.jpg")
            if second % 60 == 59:
                print(f"扫描画面 {second + 1} 秒，文字区间 {len(regions)} 个", flush=True)
    w, h = size
    return [
        {
            "id": region["id"],
            "start": region["start"],
            "end": region["last"] + 1,
            "at": region["at"],
            "box": [round(region["box"][0] / w, 4), round(region["box"][1] / h, 4),
                    round(region["box"][2] / w, 4), round(region["box"][3] / h, 4)],
        }
        for region in regions
    ]


def sheet(entries, out):
    """把裁图按给定顺序逐行从左到右排进 SHEET_EDGE 见方的图集，每张裁图上方标注 `#id mm:ss`。

    窄的招牌、人名条并排，宽的硬字幕独占一行，裁图保持原有清晰度。标签只用 ASCII，不依赖字体文件。
    """
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    sheets, cells = [], []  # 当前图集的 (条目, 标签, 裁图, x, y, 右边界)。

    def flush(height):
        """保存当前图集，记录文件路径和条目编号。"""
        canvas = np.zeros((height, max(cell[-1] for cell in cells), 3), np.uint8)
        for _, label, image, x, y, _ in cells:
            cv2.putText(canvas, label, (x, y + SHEET_LABEL_HEIGHT - 6), LABEL_FONT, LABEL_SCALE, (255, 255, 255), LABEL_THICKNESS)
            canvas[y + SHEET_LABEL_HEIGHT : y + SHEET_LABEL_HEIGHT + image.shape[0], x : x + image.shape[1]] = image
        file = out / f"{len(sheets):03d}.jpg"
        if not cv2.imwrite(str(file), canvas, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]):
            raise OSError(f"无法写入图集 {file}")
        sheets.append({"file": str(file), "ids": [entry["id"] for entry, *_ in cells]})

    x = y = row = 0  # 下一格的位置；当前行的高度。
    for entry in entries:
        image = cv2.imread(entry["file"])
        if image is None:
            raise FileNotFoundError(f"缺少裁图 {entry['file']}，先调用 media.scan()")
        scale = min(1, SHEET_EDGE / image.shape[1], SHEET_CROP_HEIGHT / image.shape[0])
        image = cv2.resize(image, (max(1, round(image.shape[1] * scale)), max(1, round(image.shape[0] * scale))),
                           interpolation=cv2.INTER_AREA)  # fmt: skip
        minutes, seconds = divmod(int(entry["start"]), 60)
        label = f"#{entry['id']} {minutes:02d}:{seconds:02d}"
        width = max(image.shape[1], cv2.getTextSize(label, LABEL_FONT, LABEL_SCALE, LABEL_THICKNESS)[0][0])
        height = SHEET_LABEL_HEIGHT + image.shape[0]
        if x and (x + width > SHEET_EDGE or y + height > SHEET_EDGE):  # 本行放不下就换行。
            x, y, row = 0, y + row + SHEET_GAP, 0
        if y and y + height > SHEET_EDGE:
            flush(y - SHEET_GAP)
            cells, x, y, row = [], 0, 0, 0
        cells.append((entry, label, image, x, y, x + width))
        x, row = x + width + SHEET_GAP, max(row, height)
    if cells:
        flush(y + row)
    return sheets


def refine(ffmpeg, source, model, width, height, duration, rows):
    """在每个边界前后各 REFINE_WINDOW 秒内按 REFINE_FPS 解码，二分查找文字出现或消失的那一帧。

    在无字的窗口端点与有字的条目中点之间二分，只需检测约 5 帧，实测比逐帧检测快约 3 倍。
    条目中点作为有字一侧，短于 1 秒的文字在窗口端点处可能还没出现。
    窗口端点仍有字（边界在窗口外）或中点没检测到文字时返回 null。各边界互相独立，按检测实例数并行。
    """
    size = frame_size(width, height)
    detect = detector(model)

    def boundary(task):
        """在无字端点与有字中点之间查找单个边界。"""
        row, edge, rising = task  # rising 为真时找文字出现，否则找文字消失。
        box = [row["box"][0] * size[0], row["box"][1] * size[1], row["box"][2] * size[0], row["box"][3] * size[1]]
        begin, end = max(0.0, edge - REFINE_WINDOW), min(duration, edge + REFINE_WINDOW)
        frames = list(decode(ffmpeg, source, size, REFINE_FPS, begin, end - begin))
        if not frames:
            return None
        present = cache(lambda i: any(iou(rect, box) >= REFINE_IOU for rect in detect(frames[i])))
        last = len(frames) - 1
        if rising and present(0):  # 窗口开头已有文字：只有窗口从片头开始才算边界。
            return 0.0 if begin == 0 else None
        if not rising and present(last):  # 窗口结尾仍有文字：只有到达片尾才算边界。
            return round(end, 2) if end >= duration else None
        inside = min(last, max(0, round(((row["start"] + row["end"]) / 2 - begin) * REFINE_FPS)))
        low, high = (0, inside) if rising else (inside, last)  # 两端状态不同，high 一侧已翻转。
        if not present(high if rising else low):
            return None
        before = present(low)
        while high - low > 1:
            middle = (low + high) // 2
            if present(middle) == before:
                low = middle
            else:
                high = middle
        return round(begin + high / REFINE_FPS, 2)

    tasks = [(row, row[key], key == "start") for row in rows for key in ("start", "end")]
    with ThreadPoolExecutor(WORKERS) as executor:
        bounds = list(executor.map(boundary, tasks))
    return [{"row": row["row"], "start": bounds[2 * i], "end": bounds[2 * i + 1]} for i, row in enumerate(rows)]


COMMANDS = {"scan": scan, "sheet": sheet, "refine": refine}

if __name__ == "__main__":
    command, job, output = sys.argv[1:]
    result = COMMANDS[command](**json.loads(Path(job).read_text("utf-8")))
    Path(output).write_text(json.dumps(result, ensure_ascii=False), "utf-8")
