"""固定音频频谱预设。两遍解码和有界直方图使内存不随素材时长增长。"""

import json
import math
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np

WIDTH, HEIGHT, FPS = 1920, 1080, 16  # 成片尺寸与帧率，背景图和字幕 PlayRes 必须一致。
RATE, FFT_SIZE, BARS = 24000, 2048, 48  # 分析采样率、Hann 窗长与竖条数。
STEP = RATE // FPS  # 每帧推进的样本数。
FLOOR = 1e-8  # 能量下界，静音时对数与参考值仍有定义。
DB_RANGE, DB_STEP = 1000, 0.01  # 覆盖 float32 PCM 的能量范围，量化误差远小于视觉容差。
LOG_TAIL = 65536  # FFmpeg 诊断只保留尾部字节。
TIMEOUT = 30  # 关闭 FFmpeg 的等待秒数。
FREQUENCIES = np.fft.rfftfreq(FFT_SIZE, 1 / RATE)
EDGES = np.geomspace(90, 10000, BARS + 1)  # 90–10000 Hz 按对数分段，每段一根竖条。
BANDS = [(FREQUENCIES >= lo) & (FREQUENCIES < hi) for lo, hi in zip(EDGES[:-1], EDGES[1:])]
WINDOW = np.hanning(FFT_SIZE)[:, None]

# 视觉映射：相对整段能量的第 99 百分位取 dB，压缩到 42 dB 动态范围，越过门限后增强峰谷。
PERCENTILE = 0.99
DYNAMIC_DB = 42
GATE, GAIN = 0.18, 1.25
RISE, FALL = 0.015, 0.065  # 平滑的上升与下降时间常数（秒）。
SILENCE = 0.025  # 平滑后低于该强度的竖条收拢到最短。

# 竖条几何：左起 x=485、宽 4 px、间距 20 px、中心 y=522，总高 4 + 360 × 强度。
BAR_LEFT, BAR_WIDTH, BAR_GAP, BAR_CENTER = 485, 4, 20, 522
BAR_MIN, BAR_RANGE = 4, 360
BAR_COLOUR = (124, 93, 164)  # BGR，即 #a45d7c。

AAC = ["-c:a", "aac", "-b:a", "128k"]  # 原音轨无法封入 MP4 时的转码参数。
H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-pix_fmt", "yuv420p"]


class Process:
    """FFmpeg 子进程。后台线程持续读取 stderr，防止管道写满阻塞，只保留有界尾部用于报错。"""

    def __init__(self, args, cwd=None, stdin=None, stdout=None):
        self.tail = b""
        self.child = subprocess.Popen(
            args,
            cwd=cwd,
            stdin=stdin,
            stdout=stdout or subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        self.reader = threading.Thread(target=self.drain)
        self.reader.start()

    def drain(self):
        while block := self.child.stderr.read(4096):
            self.tail = (self.tail + block)[-LOG_TAIL:]

    def close(self, abort=False):
        """等待退出并关闭全部管道。`abort` 用于失败路径，先结束进程且不再报告退出码。"""
        if abort and self.child.poll() is None:
            self.child.kill()
        try:
            code = self.child.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait()
            raise RuntimeError("FFmpeg did not close within its time budget")
        finally:
            self.reader.join()
            self.child.stderr.close()
            for stream in (self.child.stdin, self.child.stdout):
                if stream and not stream.closed:
                    stream.close()
        if code and not abort:
            raise RuntimeError(self.tail.decode("utf-8", "replace"))


def run(args, cwd):
    """运行一次 FFmpeg 直到结束，非零退出时以诊断尾部报错。"""
    process = Process(args, cwd=cwd)
    process.child.wait()  # 音轨转码按真实素材耗时，不套用收尾时限。
    process.close()


def incompatible(message):
    # 只接受 muxer 明确归因，权限、磁盘、损坏及未知错误不得触发有损重试。
    return bool(
        re.search(
            r"Could not find tag for codec .+ in stream #\d+, codec not currently supported in container|codec .+ not supported in container|muxer does not support .+ codec",
            message,
            re.I,
        )
    )


def energy(samples):
    """各声道分别求功率谱后平均，反相声道不会互相抵消。返回每个频段的均方根幅度。"""
    power = np.mean(np.abs(np.fft.rfft(samples * WINDOW, axis=0)) ** 2, axis=1)
    return np.array([np.sqrt(np.mean(power[band])) for band in BANDS])


def level(values, reference):
    """把频段幅度映射为 0–1 的竖条强度。"""
    db = 20 * np.log10(np.maximum(values, FLOOR) / reference)
    mapped = np.clip((db + DYNAMIC_DB) / DYNAMIC_DB, 0, 1) ** 2
    return np.clip((mapped - GATE) / (1 - GATE), 0, 1) ** GAIN


class Histogram:
    """按固定 dB 刻度累计频段幅度，内存与时长无关，近似求整段百分位。"""

    def __init__(self):
        self.counts = np.zeros(round(2 * DB_RANGE / DB_STEP) + 1, np.int64)

    def add(self, values):
        db = 20 * np.log10(np.maximum(values, np.finfo(np.float64).tiny))
        indices = np.clip(np.rint((db + DB_RANGE) / DB_STEP), 0, len(self.counts) - 1).astype(int)
        np.add.at(self.counts, indices, 1)

    def reference(self):
        """按线性插值取第 `PERCENTILE` 分位，与 `np.percentile` 的默认定义一致。"""
        cumulative = np.cumsum(self.counts)
        rank = (int(cumulative[-1]) - 1) * PERCENTILE
        values = [
            10 ** ((np.searchsorted(cumulative, index + 1) * DB_STEP - DB_RANGE) / 20)
            for index in (math.floor(rank), math.ceil(rank))
        ]
        return max(FLOOR, values[0] + (values[1] - values[0]) * (rank % 1))


def read_exact(stream, size):
    """读满 `size` 字节，流结束时返回已读部分。"""
    data = bytearray()
    while len(data) < size:
        block = stream.read(size - len(data))
        if not block:
            break
        data.extend(block)
    return bytes(data)


def spectra(ffmpeg, audio):
    """解码为 float32 PCM，逐帧产出截至该帧的窗口能量与本帧样本数。开头不足一窗时补零。"""
    process = Process(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(audio),
            "-map",
            "0:a:0",
            "-ar",
            str(RATE),
            "-c:a",
            "pcm_f32le",
            "-f",
            "wav",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
    )
    complete = False
    try:
        stream = process.child.stdout
        # WAV 头给出实际声道数，PCM 按声道交错读取。
        header = read_exact(stream, 12)
        if header[:4] != b"RIFF" or header[8:] != b"WAVE":
            raise RuntimeError("Invalid decoded WAV header")
        channels = None
        while True:
            chunk = read_exact(stream, 8)
            if len(chunk) != 8:
                raise RuntimeError("Missing decoded PCM")
            name, size = struct.unpack("<4sI", chunk)
            if name == b"data":
                break
            data = read_exact(stream, size + size % 2)
            if name == b"fmt ":
                channels = struct.unpack_from("<H", data, 2)[0]
                if struct.unpack_from("<H", data, 14)[0] != 32:
                    raise RuntimeError("Expected float32 PCM")
        if not channels:
            raise RuntimeError("Missing decoded channel layout")
        window = np.zeros((FFT_SIZE, channels), np.float64)
        while block := read_exact(stream, STEP * channels * 4):
            if len(block) % (channels * 4):
                raise RuntimeError("Truncated decoded PCM frame")
            samples = np.frombuffer(block, "<f4").reshape(-1, channels)
            if not np.isfinite(samples).all():
                raise RuntimeError("Non-finite audio samples")
            count = len(samples)
            window[:-count] = window[count:]
            window[-count:] = samples
            yield energy(window), count
        complete = True
    finally:
        process.close(abort=not complete)


def render(job, directory):
    """准备交付音轨，两遍分析其 PCM，再逐帧绘制并经管道交给 FFmpeg 编码。产物写入 `directory`。"""
    cv2.setNumThreads(1)  # CPU 留给同时运行的编码器。
    ffmpeg = job["ffmpeg"]
    base = np.fromfile(job["background"], dtype=np.uint8)
    base = cv2.imdecode(base, cv2.IMREAD_COLOR)
    if base is None or base.shape != (HEIGHT, WIDTH, 3):
        raise ValueError("Background must be a decodable 1920x1080 image")
    subtitle = Path(job["subtitles"]).read_text(encoding="utf-8-sig")
    if not all(
        re.search(rf"(?m)^PlayRes{axis}:\s*{size}\s*$", subtitle)
        for axis, size in (("X", WIDTH), ("Y", HEIGHT))
    ):
        raise ValueError("Subtitles must declare PlayResX: 1920 and PlayResY: 1080")
    # 字幕与字体复制为工作目录内的固定短名，`ass` 滤镜参数无需转义用户路径。
    (directory / "subtitles.ass").write_text(subtitle, encoding="utf-8")
    (directory / "fonts").mkdir()
    for font in Path(job["fonts"]).iterdir():
        if font.suffix.lower() in (".ttf", ".otf", ".ttc"):
            shutil.copyfile(font, directory / "fonts" / font.name)
    if not any((directory / "fonts").iterdir()):
        raise ValueError("Subtitle fonts directory is empty")

    # 先把所选音轨单独封入 MP4，同时验证封装能力。频谱分析和最终成片共用这条音轨。
    audio = directory / "audio.mp4"
    start = time.perf_counter()
    prefix = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-i",
        job["source"],
        "-map",
        f"0:a:{job['track']}",
        "-vn",
        "-sn",
        "-dn",
    ]
    mode = "copy"
    try:
        run(prefix + ["-c:a", "copy", str(audio)], directory)
    except RuntimeError as error:
        if not incompatible(str(error)):
            raise
        mode = "aac"
        run(prefix + AAC + [str(audio)], directory)
    timings = {"audio": time.perf_counter() - start}

    # 第一遍只累计直方图，取得整段参考强度。
    start = time.perf_counter()
    histogram = Histogram()
    samples = 0
    for values, count in spectra(ffmpeg, audio):
        histogram.add(values)
        samples += count
    if not samples:
        raise ValueError("Audio contains no decoded samples")
    reference = histogram.reference()
    duration = samples / RATE  # 以解码样本为准，不用容器标称时长截断。
    timings["analysis"] = time.perf_counter() - start

    # 第二遍逐帧绘制，写满管道时由编码器背压。
    start = time.perf_counter()
    args = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-s",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        str(FPS),
        "-i",
        "pipe:0",
        "-i",
        str(audio),
        "-vf",
        "ass=subtitles.ass:fontsdir=fonts",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        *H264,
        "-c:a",
        "copy",
        "-t",
        str(duration),
        "-movflags",
        "+faststart",
        "result.mp4",
    ]
    encoder = Process(args, cwd=directory, stdin=subprocess.PIPE)
    complete = False
    try:
        previous = np.zeros(BARS)
        for values, count in spectra(ffmpeg, audio):
            value = level(values, reference)
            # 按真实帧间隔做指数平滑，上升快、下降慢。
            tau = np.where(value > previous, RISE, FALL)
            previous += (1 - np.exp(-(count / RATE) / tau)) * (value - previous)
            previous[previous < SILENCE] = 0
            canvas = base.copy()
            for index, value in enumerate(previous):
                x = BAR_LEFT + BAR_WIDTH // 2 + index * BAR_GAP
                # 圆头线帽在两端各伸出半个线宽，端点内收后总高才是 BAR_MIN + BAR_RANGE × 强度。
                half = (BAR_MIN + BAR_RANGE * float(value) - BAR_WIDTH) / 2
                top, bottom = round(BAR_CENTER - half), round(BAR_CENTER + half)
                cv2.line(canvas, (x, top), (x, bottom), BAR_COLOUR, BAR_WIDTH, cv2.LINE_AA)
            encoder.child.stdin.write(canvas.tobytes())
        encoder.child.stdin.close()
        encoder.close()
        complete = True
    finally:
        if not complete:
            encoder.close(abort=True)
    timings["render"] = time.perf_counter() - start
    (directory / "result.json").write_text(
        json.dumps(
            {
                "duration": duration,
                "audio": mode,
                "timings": timings,
                "temporary_bytes": sum(
                    file.stat().st_size for file in directory.rglob("*") if file.is_file()
                ),
            }
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    file = Path(sys.argv[1]).resolve()
    render(json.loads(file.read_text(encoding="utf-8")), file.parent)
