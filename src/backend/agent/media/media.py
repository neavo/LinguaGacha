"""音视频计算的 Python 部分：解码、特征、检测前后处理、区间跟踪与图集。

由 `@lg/media` 以受控解释器启动，标准输入输出是与应用 ONNX Worker 之间的二进制通道。
本进程不创建任何模型会话，推理一律经通道请求。日志只写 stderr。

每帧为 4 字节小端无符号 JSON 头长度、UTF-8 JSON 头、头中 `bytes` 声明长度的载荷。
首帧是任务 `{"command": ..., "args": {...}}`，末帧头为 `{"result": true}`、载荷是 JSON 结果，其余为推理请求与应答。
"""

import importlib.util
import json
import math
import os
import struct
import subprocess
import sys
import threading
import traceback
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from functools import cache
from pathlib import Path

import numpy as np

HEADER_MAX = 64 * 1024  # 与 channel.ts 一致。
PAYLOAD_MAX = 64 * 1024 * 1024  # 最大输入是 1920 长边画面的检测张量，约 3 MB。
IN_FLIGHT = 2  # 每条处理分支的在途请求上限，前后处理与推理重叠一帧即可。

SAMPLE_RATE = 16000
PCM_BLOCK = 10 * SAMPLE_RATE  # 解码读块，与 VAD 请求块无关，不构成算法边界。

# SenseVoice 官方前端（config.yaml frontend_conf）：80 维 Hamming fbank、LFR m=7 n=6、am.mvn 归一化。
ASR_WINDOW = 20 * SAMPLE_RATE  # 实测 60 秒整窗明显掉字，20 秒内基本完整。
LFR_M, LFR_N = 7, 6

MAX_EDGE = 1920  # 解码长边上限，不放大。也是裁图的分辨率。
# PP-OCR 检测的前后处理取自 RapidOCR 3.10.0 `ch_ppocr_det/utils.py`（Apache-2.0），参数为其默认值。
DET_SIDE = 640  # 检测内部长边，按文字召回与耗时实测选定。
DET_THRESH, DET_BOX_THRESH, DET_UNCLIP, DET_MIN_SIZE, DET_CANDIDATES = 0.3, 0.5, 1.6, 3, 1000
LINE_GAP = 0.6  # 行间距小于较矮一行高度的该倍数时视为同一块（经验值），两行硬字幕合成一块。
TRACK_IOU = 0.5  # 相邻帧的块交并比不低于该值时归入同一区间（经验值）。
GAP_FRAMES = 1  # 区间允许连续漏检的帧数，弥补 640 检测偶尔的漏判。
CROP_MARGIN = 0.3  # 裁图四周留出块高的该倍数。
JPEG_QUALITY = 90
SHEET_EDGE = 1280  # 图集边长。画布越大，送进模型前被服务商缩小得越多，同一张裁图反而更模糊。
SHEET_CROP_HEIGHT = 160  # 裁图在图集中的最大高度。
SHEET_LABEL_HEIGHT = 24  # 裁图上方标签行的高度。
SHEET_GAP = 8  # 图集中裁图的间距。
LABEL_FONT, LABEL_SCALE, LABEL_THICKNESS = 0, 0.6, 2  # 0 是 cv2.FONT_HERSHEY_SIMPLEX，模块加载时尚未导入 cv2。
REFINE_FPS = 8  # 边界校准的检测帧率。
REFINE_WINDOW = 1  # 边界前后各取的秒数，覆盖 1 fps 区间的起止误差。
REFINE_IOU = 0.3  # 校准时块与条目 `box` 的交并比下限。高帧率下淡入淡出的块更小，阈值放宽。
REFINE_WORKERS = 2  # 同时校准的边界数，解码与检测请求交替进行。


def initialize(command):
    """按命令导入依赖。各用途只准备自己的 Python 包，纯音频识别不能因缺少图像依赖而失败。"""
    global cv2, pyclipper, knf, fsmn_vad
    if command == "speech":
        import kaldi_native_fbank as knf
        # -I 不搜索相邻目录，固定部署路径加载 VAD。
        spec = importlib.util.spec_from_file_location("fsmn_vad", Path(__file__).with_name("fsmn_vad.py"))
        fsmn_vad = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fsmn_vad)
    else:
        import cv2
        cv2.setNumThreads(1)  # 推理在 Worker 中，图像处理不再争抢 CPU。
        if command in ("scan", "refine"):
            import pyclipper


def log(message):
    """进度与诊断写 stderr，stdout 只承载通道。"""
    print(message, file=sys.stderr, flush=True)


class Channel:
    """与 Node 之间的请求通道。读线程按编号结算应答，对端退出或帧损坏时所有等待者失败。"""

    def __init__(self):
        self.input, self.output = sys.stdin.buffer, sys.stdout.buffer
        self.lock = threading.Lock()
        self.pending, self.next = {}, 0

    def read_exact(self, size):
        data = self.input.read(size)
        if len(data) != size:
            raise EOFError("通道已关闭或帧被截断")
        return data

    def read(self):
        (size,) = struct.unpack("<I", self.read_exact(4))
        if size > HEADER_MAX:
            raise ValueError(f"帧头过长：{size}")
        header = json.loads(self.read_exact(size))
        length = header.get("bytes", 0)
        if not isinstance(length, int) or not 0 <= length <= PAYLOAD_MAX:
            raise ValueError(f"载荷长度非法：{length}")
        return header, self.read_exact(length)

    def write(self, header, payload=b""):
        head = json.dumps({**header, "bytes": len(payload)}, ensure_ascii=False).encode()
        with self.lock:
            self.output.write(struct.pack("<I", len(head)) + head)
            self.output.write(payload)
            self.output.flush()

    def listen(self):
        """读线程。应答编号必须对应在途请求，否则视为协议错误。"""
        try:
            while True:
                header, payload = self.read()
                with self.lock:
                    future = self.pending.pop(header.get("id"), None)
                if future is None:
                    raise ValueError(f"未知应答：{header}")
                if "error" in header:
                    future.set_exception(RuntimeError(header["error"]))
                else:
                    future.set_result((header, payload))
        except BaseException as error:  # noqa: BLE001 读线程退出原因转交所有等待者。
            with self.lock:
                pending, self.pending = list(self.pending.values()), {}
            for future in pending:
                future.set_exception(error)

    def request(self, kind, array, **fields):
        """提交 float32 张量，返回 Future[(应答头, 载荷)]。"""
        array = np.ascontiguousarray(array, np.float32)
        future = Future()
        with self.lock:
            id, self.next = self.next, self.next + 1
            self.pending[id] = future
        self.write({"id": id, "kind": kind, "dtype": "float32", "shape": list(array.shape), **fields}, memoryview(array).cast("B"))
        return future


def tensor(header, payload):
    """按应答头还原 float32 张量，形状与字节数必须一致。"""
    shape = header["shape"]
    if header.get("dtype") != "float32" or 4 * math.prod(shape) != len(payload):
        raise ValueError(f"应答形状不符：{header}")
    return np.frombuffer(payload, np.float32).reshape(shape)


def ffmpeg_process(args):
    """诊断信息直接进日志。"""
    return subprocess.Popen(args, stdout=subprocess.PIPE)


def finish(process, consumed):
    """消费者提前停止时结束 ffmpeg；完整读完时要求正常退出。"""
    try:
        if not consumed and process.poll() is None:
            process.kill()
        code = process.wait()
        if consumed and code != 0:
            raise RuntimeError(f"ffmpeg 解码失败 ({code})")
    finally:
        process.stdout.close()


# ---------------------------------------------------------------- 语音


@cache
def asr_cmvn(file):
    """am.mvn 中 `<AddShift>` 与 `<Rescale>` 后的向量，分别是负均值与标准差倒数。"""
    lines = [line.split() for line in Path(file).read_text("utf-8").splitlines() if line.split()]
    vectors = {}
    for current, following in zip(lines, lines[1:]):
        if current[0] in ("<AddShift>", "<Rescale>") and following[0] == "<LearnRateCoef>":
            vectors[current[0]] = np.array(following[3:-1], np.float32)
    return vectors["<AddShift>"], vectors["<Rescale>"]


def asr_features(samples, mvn):
    """单窗口采样转为 [1, LFR 帧数, 560]。首帧左侧补 3 帧，尾部重复末帧，与 FunASR WavFrontend 一致。"""
    options = knf.FbankOptions()
    options.frame_opts.dither, options.frame_opts.window_type, options.frame_opts.snip_edges = 0, "hamming", True
    options.mel_opts.num_bins, options.mel_opts.high_freq, options.mel_opts.low_freq = 80, 0, 20
    fbank = knf.OnlineFbank(options)
    fbank.accept_waveform(SAMPLE_RATE, (samples * 32768).tolist())
    fbank.input_finished()
    frames = fbank.num_frames_ready
    if frames == 0:
        return None
    feats = np.stack([fbank.get_frame(i) for i in range(frames)])
    indices = np.clip(np.arange(0, frames, LFR_N)[:, None] + np.arange(-(LFR_M // 2), LFR_M // 2 + 1), 0, frames - 1)
    neg_mean, inv_std = asr_cmvn(mvn)
    return ((feats[indices].reshape(-1, LFR_M * 80) + neg_mean) * inv_std)[None].astype(np.float32)


def speech(channel, ffmpeg, source, track, center, language, asr_mvn, vad_mvn):
    """一次解码完成人声检测与识别。返回人声采样区间与各识别窗口的 token。

    部分容器以音轨起点为零点，补齐起点并保留画面流后与画面检测的零点一致。
    5.1、7.1 音轨的对白集中在中置声道，只取该声道识别。
    """
    audio = "aresample=first_pts=0" + (",pan=mono|c0=FC" if center else "")
    process = ffmpeg_process(
        [ffmpeg, "-hide_banner", "-nostdin", "-v", "error", "-i", source, "-map", f"0:a:{track}", "-af", audio,
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1", "-map", "0:V:0?", "-c", "copy", "-f", "null", "-"]
    )  # fmt: skip
    frontend, segmenter = fsmn_vad.Frontend(vad_mvn), fsmn_vad.Segmenter()
    spans, windows, inflight = [], [], deque()
    retained, offset = np.zeros(0, np.float32), 0  # 缓冲中的采样及其起点。

    def settle(limit):
        while len(inflight) > limit:
            index, future = inflight.popleft()
            header, _ = future.result()
            windows[index].update(tokens=header["tokens"], timestamps=header["timestamps"])

    def emit(start, end):
        """长段均分为不超过 20 秒的窗口，逐个提交识别。"""
        spans.append([start, end])
        count = math.ceil((end - start) / ASR_WINDOW)
        for i in range(count):
            begin = start + math.floor((end - start) * i / count + 0.5)
            stop = start + math.floor((end - start) * (i + 1) / count + 0.5)
            features = asr_features(retained[begin - offset : stop - offset], asr_mvn)
            windows.append({"from": begin, "end": stop, "tokens": [], "timestamps": []})
            if features is not None:
                settle(IN_FLIGHT - 1)
                inflight.append((len(windows) - 1, channel.request("asr", features, language=language)))

    def consume(final):
        """把前端已就绪的特征块送去推理和分段，再释放分段与前端都不再需要的 PCM。"""
        nonlocal retained, offset
        while (batch := frontend.take(final)) is not None:
            frame, features, last = batch
            begin = frame * fsmn_vad.FRAME_SHIFT
            end = (frame + features.shape[1] - 1) * fsmn_vad.FRAME_SHIFT + fsmn_vad.FRAME_LENGTH
            scores = tensor(*channel.request("vad", features).result())
            for start, stop in segmenter.accept(scores, retained[begin - offset:end - offset], last):
                emit(start, stop)
            # 未完成语音和下一批能量计算仍需 PCM。已复制的 ASR 特征不再持有它。
            keep = min(segmenter.retained_sample, frontend.offset * fsmn_vad.FRAME_SHIFT)
            retained, offset = retained[keep - offset:].copy(), keep

    consumed = False
    try:
        while data := process.stdout.read(PCM_BLOCK * 2):
            if len(data) % 2:
                raise ValueError("PCM 采样不完整")
            samples = np.frombuffer(data, "<i2").astype(np.float32) / 32768
            retained = np.concatenate((retained, samples))
            frontend.accept(samples)
            consume(False)
        frontend.accept(np.zeros(0, np.float32), final=True)
        consume(True)
        settle(0)
        consumed = True
    finally:
        finish(process, consumed)
    return {"spans": spans, "windows": windows}


# ---------------------------------------------------------------- 画面


def frame_size(width, height):
    """解码尺寸：长边不超过 MAX_EDGE，保持比例，不放大。"""
    scale = min(1, MAX_EDGE / max(width, height))
    return round(width * scale), round(height * scale)


def decode(ffmpeg, source, size, fps, start=None, duration=None):
    """按固定帧率逐帧产出 BGR 画面。`start_time=0` 使第 i 帧正好是第 i/fps 秒，与音频零点一致。

    FFmpeg 自动选择硬件解码，输出普通内存帧供缩放与检测消费。
    """
    width, height = size
    args = [ffmpeg, "-hide_banner", "-nostdin", "-v", "error", "-hwaccel", "auto"]
    if start is not None:
        args += ["-ss", str(start), "-t", str(duration)]
    filters = [f"fps={fps}:start_time=0", f"scale={width}:{height}"]
    process = ffmpeg_process(
        args + ["-i", source, "-map", "0:V:0", "-an", "-sn", "-vf", ",".join(filters), "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"]
    )  # fmt: skip
    frame_bytes, consumed = width * height * 3, False
    try:
        while len(data := process.stdout.read(frame_bytes)) == frame_bytes:
            yield np.frombuffer(data, np.uint8).reshape(height, width, 3)
        consumed = True
    finally:
        finish(process, consumed)


def det_input(frame):
    """缩放到长边 640、边长取 32 的倍数，归一化为 [1, 3, H, W]。"""
    height, width = frame.shape[:2]
    ratio = min(1.0, DET_SIDE / max(height, width))
    size = (int(round(int(width * ratio) / 32) * 32), int(round(int(height * ratio) / 32) * 32))
    image = cv2.resize(frame, size).astype(np.float32) / 127.5 - 1
    return image.transpose(2, 0, 1)[None]


def mini_box(contour):
    """最小外接矩形的四点（左上起顺时针）与短边长。"""
    rect = cv2.minAreaRect(contour)
    points = sorted(cv2.boxPoints(rect).tolist(), key=lambda point: point[0])
    left = sorted(points[:2], key=lambda point: point[1])
    right = sorted(points[2:], key=lambda point: point[1])
    return np.array([left[0], right[0], right[1], left[1]], np.float32), min(rect[1])


def det_boxes(pred, height, width):
    """DB 后处理：二值化、膨胀、轮廓评分与外扩，返回原画面坐标的四点框。"""
    bitmap = cv2.dilate((pred > DET_THRESH).astype(np.uint8), np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(bitmap * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    map_h, map_w = pred.shape
    boxes = []
    for contour in contours[:DET_CANDIDATES]:
        points, side = mini_box(contour)
        if side < DET_MIN_SIZE:
            continue
        x0, x1 = np.clip([math.floor(points[:, 0].min()), math.ceil(points[:, 0].max())], 0, map_w - 1)
        y0, y1 = np.clip([math.floor(points[:, 1].min()), math.ceil(points[:, 1].max())], 0, map_h - 1)
        mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
        cv2.fillPoly(mask, (points - [x0, y0]).reshape(1, -1, 2).astype(np.int32), 1)
        if cv2.mean(pred[y0 : y1 + 1, x0 : x1 + 1], mask)[0] < DET_BOX_THRESH:
            continue
        distance = cv2.contourArea(points) * DET_UNCLIP / cv2.arcLength(points, True)
        offset = pyclipper.PyclipperOffset()
        offset.AddPath(points.tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
        expanded, side = mini_box(np.array(offset.Execute(distance), np.float32).reshape(-1, 1, 2))
        if side < DET_MIN_SIZE + 2:
            continue
        box = np.empty_like(expanded)
        box[:, 0] = np.clip(np.round(expanded[:, 0] / map_w * width), 0, width - 1)
        box[:, 1] = np.clip(np.round(expanded[:, 1] / map_h * height), 0, height - 1)
        box = clockwise(box)
        if int(np.linalg.norm(box[0] - box[1])) > DET_MIN_SIZE and int(np.linalg.norm(box[0] - box[3])) > DET_MIN_SIZE:
            boxes.append(box)
    return sort_boxes(boxes)


def clockwise(points):
    """按 x 分左右两对，各自按 y 排出左上、右上、右下、左下。"""
    ordered = points[np.argsort(points[:, 0], kind="stable")]
    left = ordered[:2][np.argsort(ordered[:2, 1], kind="stable")]
    right = ordered[2:][np.argsort(ordered[2:, 1], kind="stable")]
    return np.array([left[0], right[0], right[1], left[1]], np.float32)


def sort_boxes(boxes):
    """从上到下、同一行从左到右。左上角 y 相差不足 10 像素视为同一行，顺序决定区间编号。"""
    if not boxes:
        return boxes
    by_y = sorted(boxes, key=lambda box: box[0, 1])
    lines = np.concatenate([[0], np.cumsum(np.diff([box[0, 1] for box in by_y]) >= 10)])
    return [by_y[i] for i in np.lexsort(([box[0, 0] for box in by_y], lines))]


def det_blocks(header, payload, frame):
    """检测应答转为合并后的文字块，先过滤误框成整幅画面的纹理。"""
    pred = tensor(header, payload)
    height = frame.shape[0]
    found = det_boxes(pred.reshape(pred.shape[-2:]), height, frame.shape[1])
    return blocks(found)


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


def write_jpeg(file, image):
    """通过 Python 写入 JPEG，避免依赖 OpenCV 的 Windows Unicode 路径支持。"""
    success, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not success:
        raise OSError(f"无法编码 JPEG {file}")
    file.write_bytes(encoded.tobytes())


def crop(frame, rect, file):
    """按块裁图，四周留出块高的边距。"""
    height, width = frame.shape[:2]
    margin = CROP_MARGIN * (rect[3] - rect[1])
    x0, y0 = max(0, int(rect[0] - margin)), max(0, int(rect[1] - margin))
    x1, y1 = min(width, int(rect[2] + margin + 1)), min(height, int(rect[3] + margin + 1))
    write_jpeg(file, frame[y0:y1, x0:x1])


def scan(channel, ffmpeg, source, width, height, out):
    """1 fps 检测整片，按位置把块串成区间，每个区间保存文字框最大那一帧的裁图到 `out`。

    `start` 是首次检测到的秒数，`end` 是最后一次检测到的秒数加 1，`box` 是各帧块的归一化并集。
    """
    size = frame_size(width, height)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    regions, active, inflight = [], [], deque()  # 全部区间；还能延续的区间；在途检测。

    def track(second, frame, found):
        nonlocal active
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
                crop(frame, rect, out / f"{match['id']}.jpg")
        if second % 60 == 59:
            log(f"扫描画面 {second + 1} 秒，文字区间 {len(regions)} 个")

    def settle(limit):
        while len(inflight) > limit:
            second, frame, future = inflight.popleft()
            track(second, frame, det_blocks(*future.result(), frame))

    for second, frame in enumerate(decode(ffmpeg, source, size, 1)):
        settle(IN_FLIGHT - 1)
        inflight.append((second, frame, channel.request("det", det_input(frame))))
    settle(0)
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
    ]  # fmt: skip


def refine(channel, ffmpeg, source, width, height, duration, rows):
    """在每个边界前后各 REFINE_WINDOW 秒内按 REFINE_FPS 解码，二分查找文字出现或消失的那一帧。

    在无字的窗口端点与有字的条目中点之间二分，只需检测约 5 帧。
    窗口端点仍有字（边界在窗口外）或中点没检测到文字时返回 null。
    """
    size = frame_size(width, height)

    def boundary(task):
        """在无字端点与有字中点之间查找单个边界。"""
        row, edge, rising = task  # rising 为真时找文字出现，否则找文字消失。
        box = [row["box"][0] * size[0], row["box"][1] * size[1], row["box"][2] * size[0], row["box"][3] * size[1]]
        begin, end = max(0.0, edge - REFINE_WINDOW), min(duration, edge + REFINE_WINDOW)
        frames = list(decode(ffmpeg, source, size, REFINE_FPS, begin, end - begin))
        if not frames:
            return None

        @cache
        def present(i):
            found = det_blocks(*channel.request("det", det_input(frames[i])).result(), frames[i])
            return any(iou(rect, box) >= REFINE_IOU for rect in found)

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
    with ThreadPoolExecutor(REFINE_WORKERS) as executor:
        bounds = list(executor.map(boundary, tasks))
    return [{"row": row["row"], "start": bounds[2 * i], "end": bounds[2 * i + 1]} for i, row in enumerate(rows)]


def sheet(channel, entries, out):
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
        write_jpeg(file, canvas)
        sheets.append({"file": str(file), "ids": [entry["id"] for entry, *_ in cells]})

    x = y = row = 0  # 下一格的位置；当前行的高度。
    for entry in entries:
        data = np.fromfile(entry["file"], dtype=np.uint8)
        # 空文件会触发 OpenCV 断言，统一按无法解码处理。
        image = cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None
        if image is None:
            raise ValueError(f"无法解码裁图 {entry['file']}")
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


COMMANDS = {"speech": speech, "scan": scan, "refine": refine, "sheet": sheet}

if __name__ == "__main__":
    channel = Channel()
    job, _ = channel.read()
    reader = threading.Thread(target=channel.listen)
    reader.start()
    try:
        initialize(job["command"])
        result = COMMANDS[job["command"]](channel, **job["args"])
    except BaseException as error:
        channel.write({"error": str(error)})
        traceback.print_exc()
        sys.stderr.flush()
        os._exit(1)  # 读线程仍阻塞在 stdin 上，解释器无法正常收尾。
    channel.write({"result": True}, json.dumps(result, ensure_ascii=False).encode())
    reader.join()  # 根脚本收到结果后关闭 stdin，读线程随 EOF 结束。
