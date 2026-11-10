"""media.py 的检测后处理与语音分窗边界。用部署的 -I 解释器执行，参数是部署的 runtime 目录。"""

import importlib.util
import io
import sys
import tempfile
from concurrent.futures import Future
from pathlib import Path

import numpy as np

runtime = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("media", runtime / "media.py")
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)

media.initialize("scan")  # 本文件同时检查检测与语音，两组依赖都加载。
media.initialize("speech")

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
