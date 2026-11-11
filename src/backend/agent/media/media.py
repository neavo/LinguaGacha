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
from collections import Counter, deque
from concurrent.futures import Future
from contextlib import closing
from functools import cache
from pathlib import Path
from typing import NamedTuple

import numpy as np

HEADER_MAX = 64 * 1024  # 与 channel.ts 一致。
PAYLOAD_MAX = 64 * 1024 * 1024  # 检测图与按长宽比展开的文字行共用载荷上限。
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
TRACK_IOU = 0.5  # 位置只用于唯一匹配候选，内容由 OCR 另行判断。
REC_HEIGHT, REC_MIN_WIDTH = 48, 320  # RapidOCR 的文字行输入尺寸，宽度随长宽比扩展。
REC_VERTICAL_RATIO = 1.5  # 沿用 RapidOCR 的高竖框旋转规则。
TEXT_DIFFERENCE = 0.25  # 字符编号的编辑距离比例，空识别不能作为内容相同的证据。
CROP_MARGIN = 0.3  # 裁图四周留出块高的该倍数。
JPEG_QUALITY = 90
SHEET_EDGE = 1280  # 图集边长。画布越大，送进模型前被服务商缩小得越多，同一张裁图反而更模糊。
SHEET_CROP_HEIGHT = 160  # 裁图在图集中的最大高度。
SHEET_LABEL_HEIGHT = 24  # 裁图上方标签行的高度。
SHEET_GAP = 8  # 图集中裁图的间距。
LABEL_FONT, LABEL_SCALE, LABEL_THICKNESS = 0, 0.6, 2  # 0 是 cv2.FONT_HERSHEY_SIMPLEX，模块加载时尚未导入 cv2。
REFINE_FPS = 4  # 相邻样本间隔 250 ms，边界取两个样本时间的中点。
REFINE_WINDOW = 1  # 边界前后各取的秒数，覆盖 1 fps 区间的起止误差。
REFINE_IOU = 0.3  # 校准时块与条目 `box` 的交并比下限。高帧率下淡入淡出的块更小，阈值放宽。
REFINE_DECODE_GAP = 2  # 顺序读过短空档，摊薄 FFmpeg 启动与寻帧成本。空档帧不参与推理。


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


class DetectedBlock(NamedTuple):
    """几何分组保留成员行四边形，供调用者筛选后识别。"""

    rect: tuple[float, float, float, float]
    members: tuple[np.ndarray, ...]


class TextBlock(NamedTuple):
    """保留成员行顺序的文字块，防止短行变化被整块长文本稀释。"""

    rect: tuple[float, float, float, float]
    lines: tuple[tuple[int, ...], ...]


def rec_input(frame, points):
    """透视裁剪后按 RapidOCR 规则归一化，长文字行扩宽而不截断。"""
    width = int(max(np.linalg.norm(points[0] - points[1]), np.linalg.norm(points[2] - points[3])))
    height = int(max(np.linalg.norm(points[0] - points[3]), np.linalg.norm(points[1] - points[2])))
    target = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    transform = cv2.getPerspectiveTransform(points.astype(np.float32), target)
    image = cv2.warpPerspective(
        frame, transform, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    if height / width >= REC_VERTICAL_RATIO:
        image = np.rot90(image)
    ratio = image.shape[1] / image.shape[0]
    width = int(REC_HEIGHT * max(REC_MIN_WIDTH / REC_HEIGHT, ratio))
    resized = min(width, math.ceil(REC_HEIGHT * ratio))
    data = cv2.resize(image, (resized, REC_HEIGHT)).astype(np.float32).transpose(2, 0, 1) / 255
    result = np.zeros((1, 3, REC_HEIGHT, width), np.float32)
    result[0, :, :, :resized] = (data - 0.5) / 0.5
    return result


def detect_blocks(header, payload, frame):
    """先按几何关系分组，让区域筛选与 OCR 是否成功无关。"""
    pred = tensor(header, payload)
    height = frame.shape[0]
    found = det_boxes(pred.reshape(pred.shape[-2:]), height, frame.shape[1])
    return group_lines(found)


def read_block(channel, frame, block):
    """识别一个文字块的成员行。相同帧内的多个条目共享该结果。"""
    lines = []
    for points in block.members:
        reply, _ = channel.request("rec", rec_input(frame, points)).result()
        tokens = reply["tokens"]
        if not isinstance(tokens, list) or any(type(token) is not int or token <= 0 for token in tokens):
            raise ValueError("OCR 字符编号无效")
        lines.append(tuple(tokens))
    return TextBlock(block.rect, tuple(lines))


def group_lines(boxes):
    """相邻检测行组成文字块，同时保留检测排序给出的成员行归属。"""
    rects = [
        (float(box[:, 0].min()), float(box[:, 1].min()), float(box[:, 0].max()), float(box[:, 1].max()))
        for box in map(np.asarray, boxes)
    ]
    members = [[i] for i in range(len(rects))]
    merged = True
    while merged:
        merged = False
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a, b = rects[i], rects[j]
                gap = max(a[1], b[1]) - min(a[3], b[3])  # 负数表示上下重叠。
                if min(a[2], b[2]) > max(a[0], b[0]) and gap < LINE_GAP * min(a[3] - a[1], b[3] - b[1]):
                    rects[i] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
                    members[i].extend(members.pop(j))
                    del rects[j]
                    merged = True
                    break
            if merged:
                break
    return [DetectedBlock(rect, tuple(boxes[i] for i in sorted(indices))) for rect, indices in zip(rects, members)]


def similar_line(a, b):
    """保留所有字符参与容错比较。空识别总是未知。"""
    if not a or not b:
        return False
    limit = math.floor(max(len(a), len(b)) * TEXT_DIFFERENCE)
    if abs(len(a) - len(b)) > limit:
        return False
    previous = list(range(len(b) + 1))
    for i, token in enumerate(a, 1):
        current = [i]
        for j, other in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (token != other)))
        previous = current
    return previous[-1] <= limit


def same_content(a, b):
    """布局变化或任何成员行未知时拆开，避免整块合并吞掉局部变化。"""
    return bool(a) and len(a) == len(b) and all(similar_line(x, y) for x, y in zip(a, b))


class TextTracker:
    """维护连续帧的内容区间。OCR 序列只在上一帧状态中保留。"""

    def __init__(self):
        """区间跨帧累积，匹配状态只保留上一帧与区间首帧参照。"""
        self.regions = []  # 全部区间的输出元数据，供扫描结束时发布。
        self.previous = []  # 只在相邻采样帧之间传递位置与 OCR 参照。

    def update(self, second, found):
        """双向唯一且内容稳定时延续区间，返回需要更新的代表裁图。"""
        candidates = [
            [i for i, old in enumerate(self.previous) if iou(block.rect, old["rect"]) >= TRACK_IOU] for block in found
        ]
        uses = Counter(i for choices in candidates for i in choices)  # 一次计数，检查旧块是否被争用。
        current, crops = [], []
        for block, choices in zip(found, candidates):
            old = self.previous[choices[0]] if len(choices) == 1 and uses[choices[0]] == 1 else None
            if old is None or not (
                same_content(block.lines, old["lines"]) and same_content(block.lines, old["anchor"])
            ):
                old = {"id": len(self.regions), "anchor": block.lines}  # 首帧参照不随代表裁图更新。
                self.regions.append({"id": old["id"], "start": second, "box": block.rect, "size": -1})
            region = self.regions[old["id"]]
            box, rect = region["box"], block.rect
            region.update(
                end=second + 1,
                box=(min(box[0], rect[0]), min(box[1], rect[1]), max(box[2], rect[2]), max(box[3], rect[3])),
            )
            if area(rect) > region["size"]:
                region.update(size=area(rect), at=second)
                crops.append((region["id"], rect))
            current.append({**old, "rect": rect, "lines": block.lines})
        self.previous = current  # 空白、未知和竞争均不能唤回更早的轨迹。
        return crops


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
    """1 fps 检测和识别整片，按位置与内容分段，未知内容仍保留独立裁图。

    `start/end` 是采样区间，`box` 是匹配框的并集。最大文字框的裁图用于后续看图。
    """
    size = frame_size(width, height)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    tracker, inflight = TextTracker(), deque()

    def settle(limit):
        """按采样顺序结算异步检测，让上一帧状态始终对应真实相邻帧。"""
        while len(inflight) > limit:
            second, frame, future = inflight.popleft()
            found = [read_block(channel, frame, block) for block in detect_blocks(*future.result(), frame)]
            for id, rect in tracker.update(second, found):
                crop(frame, rect, out / f"{id}.jpg")
            if second % 60 == 59:
                log(f"扫描画面 {second + 1} 秒，文字区间 {len(tracker.regions)} 个")

    for second, frame in enumerate(decode(ffmpeg, source, size, 1)):
        settle(IN_FLIGHT - 1)
        inflight.append((second, frame, channel.request("det", det_input(frame))))
    settle(0)
    w, h = size
    return [
        {
            "id": region["id"],
            "start": region["start"],
            "end": region["end"],
            "at": region["at"],
            "box": [round(region["box"][0] / w, 4), round(region["box"][1] / h, 4),
                    round(region["box"][2] / w, 4), round(region["box"][3] / h, 4)],
        }
        for region in tracker.regions
    ]  # fmt: skip


def refine_plan(rows, duration):
    """边界窗口共享全片采样网格。极短条目没有内部网格点时保留精确中点。"""
    references, windows, requests = [], [], {}
    last_tick = math.ceil(duration * REFINE_FPS) - 1
    for index, row in enumerate(rows):
        first = math.ceil(row["start"] * REFINE_FPS)
        last = math.ceil(row["end"] * REFINE_FPS) - 1
        middle = (row["start"] + row["end"]) / 2
        reference = min(last, max(first, round(middle * REFINE_FPS))) / REFINE_FPS if first <= last else middle
        references.append(reference)
        edges = {}
        for key in ("start", "end"):
            begin, end = max(0.0, row[key] - REFINE_WINDOW), min(duration, row[key] + REFINE_WINDOW)
            # 外侧样本用于夹住边界，最终估计仍须落在原始允许窗口内。
            ticks = range(math.floor(begin * REFINE_FPS), min(last_tick, math.ceil(end * REFINE_FPS)) + 1)
            edges[key] = [tick / REFINE_FPS for tick in ticks]
        windows.append(edges)
        for at in {reference, *edges["start"], *edges["end"]}:
            requests.setdefault(at, set()).add(index)
    return references, windows, requests


def refine_frames(ffmpeg, source, size, duration, times):
    """合并同一采样网格的邻近窗口，只向推理提交请求帧。长空档分开读取。"""
    runs = []
    step = 1 / REFINE_FPS
    for at in sorted(times):
        # 精确中点可能偏离全片网格，只合并采样相位相同的窗口。
        if runs and at - runs[-1][-1] <= REFINE_DECODE_GAP + step and ((at - runs[-1][0]) * REFINE_FPS).is_integer():
            runs[-1].append(at)
        else:
            runs.append([at])
    for run in runs:
        end = min(duration, run[-1] + step)
        wanted = set(run)
        with closing(decode(ffmpeg, source, size, REFINE_FPS, run[0], end - run[0])) as frames:
            for i, frame in enumerate(frames):
                at = run[0] + i / REFINE_FPS
                if at in wanted:
                    yield at, frame


def refine(channel, ffmpeg, source, width, height, duration, rows):
    """整批共享解码和检测，同一帧的唯一候选只识别一次。条目仍独立判定边界。"""
    size = frame_size(width, height)
    references, windows, requests = refine_plan(rows, duration)
    boxes = [(r["box"][0] * size[0], r["box"][1] * size[1], r["box"][2] * size[0], r["box"][3] * size[1]) for r in rows]
    observations = [{} for _ in rows]  # False 表示无候选，None 表示未知，tuple 保存有效 OCR。
    remaining = [len({ref, *edges["start"], *edges["end"]}) for ref, edges in zip(references, windows)]
    result = [{"row": r["row"], "start": None, "end": None} for r in rows]
    inflight = deque()

    def complete(index):
        """两个边界使用同一内容参照，窗口取完后释放该行的观察结果。"""
        values = observations[index]
        reference = values.get(references[index])
        if reference:
            for key, times in windows[index].items():
                if not times:
                    continue
                states = []
                for at in times:
                    value = values.get(at)
                    states.append(same_content(value, reference) if isinstance(value, tuple) else value)
                end = min(duration, times[-1] + 1 / REFINE_FPS)
                bound = text_boundary(states, times[0], end, duration, key == "start")
                edge = rows[index][key]
                if bound is not None and max(0, edge - REFINE_WINDOW) <= bound <= min(duration, edge + REFINE_WINDOW):
                    result[index][key] = bound
        values.clear()

    def settle(limit):
        """按时间结算检测，只识别至少一个条目需要的唯一候选。"""
        while len(inflight) > limit:
            at, frame, future = inflight.popleft()
            found = detect_blocks(*future.result(), frame)
            recognized = {}  # 同一检测块可供多个区域重叠的条目使用。
            for index in requests.pop(at):
                choices = [i for i, block in enumerate(found) if iou(block.rect, boxes[index]) >= REFINE_IOU]
                value = None
                if not choices:
                    value = False
                elif len(choices) == 1:
                    choice = choices[0]
                    if choice not in recognized:
                        recognized[choice] = read_block(channel, frame, found[choice]).lines
                    if all(recognized[choice]):
                        value = recognized[choice]
                observations[index][at] = value
                remaining[index] -= 1
                if remaining[index] == 0:
                    complete(index)

    with closing(refine_frames(ffmpeg, source, size, duration, requests)) as frames:
        for at, frame in frames:
            settle(IN_FLIGHT - 1)
            inflight.append((at, frame, channel.request("det", det_input(frame))))
        settle(0)
    # 未读到的采样保留为未知，避免提前结束解码时发布猜测边界。
    return result


def text_boundary(states, begin, end, duration, rising):
    """只接受窗口内唯一连续的同内容区间。未知或重复出现交还调用者复核。"""
    if not states or None in states:
        return None
    present = [i for i, value in enumerate(states) if value]
    if not present or present[-1] - present[0] + 1 != len(present):
        return None
    if rising:
        if present[0] == 0:
            return 0.0 if begin == 0 else None
        return round(begin + (present[0] - 0.5) / REFINE_FPS, 3)
    if present[-1] == len(states) - 1:
        # 提前结束解码不能伪装成片尾；末样本必须覆盖窗口尾部。
        return round(duration, 3) if end >= duration and begin + len(states) / REFINE_FPS >= end else None
    return round(begin + (present[-1] + 0.5) / REFINE_FPS, 3)


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
