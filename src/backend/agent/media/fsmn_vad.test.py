"""连续前端与分段器对照固定上游预期。用部署的 -I 解释器执行，参数是部署的 runtime 目录。"""

import importlib.util
import sys
import tempfile
from pathlib import Path

import numpy as np


def load(file):
    """按部署路径加载模块，与产品的 -I 加载方式一致。"""
    spec = importlib.util.spec_from_file_location(file.stem, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = Path(sys.argv[1])
vad = load(runtime / "fsmn_vad.py")
with tempfile.TemporaryDirectory(prefix="media frontend ") as directory:
    mvn = Path(directory) / "fixture.mvn"
    mvn.write_text("<AddShift>\n<LearnRateCoef> 1 [ " + "0 " * 400 + "]\n<Rescale>\n<LearnRateCoef> 1 [ " + "1 " * 400 + "]\n")
    for length in [0, 399, 400, 561, 6000 * 160 + 240, 12001 * 160 + 253]:
        wave = np.random.default_rng(length).normal(0, 0.1, length).astype(np.float32)
        results = []
        for chunk in [723, 160000]:
            frontend = vad.Frontend(mvn)
            parts = []
            for begin in range(0, length, chunk):
                frontend.accept(wave[begin:begin + chunk])
                while (batch := frontend.take()) is not None:
                    assert not batch[2]
                    parts.append(batch[1])
            frontend.accept(np.zeros(0, np.float32), True)
            while (batch := frontend.take(True)) is not None:
                parts.append(batch[1])
            assert all(0 < part.shape[1] <= 6000 for part in parts)
            results.append(np.concatenate(parts, axis=1) if parts else np.empty((1, 0, 400)))
        np.testing.assert_array_equal(*results)
        assert results[0].shape[1] == max(0, (length - 400) // 160 + 1)

# 预期由独立 funasr-onnx 0.4.9 E2EVadModel 以相同分块生成，单位毫秒。
for frames, start, end, expected in [
    (1, 0, 1, []),
    (400, 100, 200, [[740, 2160]]),
    (2001, 0, 2001, [[0, 20010]]),
    (6100, 5950, 6080, [[59240, 61000]]),
]:
    scores = np.full((1, frames, 248), 0.01, np.float32)
    scores[0, :, 0] = 0.99
    scores[0, start:end, 0] = 0.01
    segmenter, actual = vad.Segmenter(), []
    for offset in range(0, frames, 6000):
        count = min(6000, frames - offset)
        wave = np.full((count - 1) * 160 + 400, 0.1, np.float32)
        actual += segmenter.accept(scores[:, offset:offset + count], wave, offset + count == frames)
    assert actual == [[start * 16, end * 16] for start, end in expected], (actual, expected)
print("fsmn_vad boundaries passed")
