"""media.py 的图片读写、检测后处理与语音分窗边界。参数是源码或部署的 runtime 目录。"""

import importlib.util
import io
import sys
import tempfile
from concurrent.futures import Future
from contextlib import chdir
from pathlib import Path
from unittest import TestCase

import numpy as np

runtime = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("media", runtime / "media.py")
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)

media.initialize("scan")  # 本文件同时检查检测与语音，两组依赖都加载。
media.initialize("speech")

# 中文必须出现在传入的路径中，仅工作目录含中文不足以复现路径问题。
check = TestCase()
with tempfile.TemporaryDirectory(prefix="media images ") as directory, chdir(directory):
    colour = (20, 80, 220)
    frame = np.full((24, 48, 3), colour, dtype=np.uint8)
    for root in (Path.cwd() / "中文绝对路径", Path("中文相对路径")):
        root.mkdir()
        file = root / "字幕裁图.jpg"
        media.crop(frame, [0, 0, 48, 24], file)
        crop = media.cv2.imdecode(np.fromfile(file, dtype=np.uint8), media.cv2.IMREAD_COLOR)
        assert crop is not None and crop.shape == frame.shape
        entries = [{"id": 7, "start": 12, "file": str(file)}]
        sheets = media.sheet(None, entries, root / "字幕图集")
        assert len(sheets) == 1 and sheets[0]["ids"] == [7], sheets
        image = media.cv2.imdecode(np.fromfile(sheets[0]["file"], dtype=np.uint8), media.cv2.IMREAD_COLOR)
        assert image is not None and image.shape[0] > frame.shape[0]
        assert np.allclose(image[-frame.shape[0]:, :frame.shape[1]].mean(axis=(0, 1)), colour, atol=5)

    for name, content, error in (
        ("缺失.jpg", None, FileNotFoundError),
        ("空文件.jpg", b"", ValueError),
        ("损坏.jpg", b"not an image", ValueError),
    ):
        file = Path(name)
        if content is not None:
            file.write_bytes(content)
        with check.assertRaises(error) as raised:
            media.sheet(None, [{"id": 7, "start": 12, "file": str(file)}], "失败图集")
        assert str(file) in str(raised.exception)

    # 用已有目录触发真实写入失败，避免依赖不同平台的只读权限语义。
    with check.assertRaises(OSError):
        media.crop(frame, [0, 0, 48, 24], Path(directory))

# 真实 DB 后处理链保留高竖排候选，scan/refine 共用 det_blocks。
pred = np.zeros((100, 100), np.float32)
pred[10:90, 40:55] = 0.99
boxes = media.det_blocks({"shape": [100, 100], "dtype": "float32"}, pred.tobytes(), np.zeros((100, 100, 3), np.uint8))
assert any(box[3] - box[1] > 50 for box in boxes), boxes

# 调用真实 speech/ASR 前端，证明 20.01 秒区间仍按整数采样均分成两个窗口。
with tempfile.TemporaryDirectory(prefix="media windows ") as directory:
    files = []
    for dimensions in [400, 560]:
        file = Path(directory) / f"{dimensions}.mvn"
        file.write_text("<AddShift>\n<LearnRateCoef> 1 [ " + "0 " * dimensions + "]\n<Rescale>\n<LearnRateCoef> 1 [ " + "1 " * dimensions + "]\n")
        files.append(str(file))

    class Decoder:
        stdout = io.BytesIO(np.full(320400, 1000, "<i2").tobytes())

        def wait(self):
            return 0

    class Inference:
        def request(self, kind, features, **fields):
            future = Future()
            if kind == "vad":
                scores = np.full((1, features.shape[1], 248), 0.01, np.float32)
                future.set_result(({"shape": list(scores.shape), "dtype": "float32"}, scores.tobytes()))
            else:
                assert features.shape[2] == 560
                future.set_result(({"tokens": ["fixture"], "timestamps": [0]}, b""))
            return future

    media.ffmpeg_process = lambda args: Decoder()
    result = media.speech(Inference(), "unused", "unused", 0, False, "auto", files[1], files[0])
    assert result["spans"] == [[0, 320160]], result
    assert [[window["from"], window["end"]] for window in result["windows"]] == [[0, 160080], [160080, 320160]]
    assert all(window["tokens"] == ["fixture"] for window in result["windows"])
print("media boundaries passed")
