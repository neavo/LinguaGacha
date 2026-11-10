"""用合成信号检查频谱与统计误差，不绑定技能资源。"""

import importlib.util
import sys
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location("visualize", Path(sys.argv[1]) / "visualize.py")
visual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual)
wave = np.sin(np.arange(visual.FFT_SIZE) * 2 * np.pi * 440 / visual.RATE)
mono = visual.energy(wave[:, None])
stereo = visual.energy(np.column_stack((wave, -wave)))
assert np.allclose(mono, stereo), "反相声道不能互相抵消"
assert np.all(visual.energy(np.zeros((visual.FFT_SIZE, 2))) == 0)
assert np.all(visual.level(np.zeros(visual.BARS), 1) == 0)
assert np.all(np.diff(visual.level(np.linspace(0, 2, 1000), 1)) >= 0)
rng = np.random.default_rng(42)
for values in (
    rng.lognormal(-4, 3, 10000),
    np.zeros(100),
    np.ones(100),
    np.r_[np.zeros(990), np.ones(10)],
):
    histogram = visual.Histogram()
    for block in np.array_split(values, 13):
        histogram.add(block)
    exact = max(visual.FLOOR, np.percentile(values, 99))
    assert (
        np.max(np.abs(visual.level(values, exact) - visual.level(values, histogram.reference())))
        <= 0.01
    )
assert visual.incompatible(
    "Could not find tag for codec pcm_s16le in stream #0, codec not currently supported in container"
)
for message in (
    "Permission denied",
    "No space left on device",
    "Invalid data found when processing input",
    "Interrupted",
):
    assert not visual.incompatible(message)
print("spectrum, bounded percentile and mux classification passed")
