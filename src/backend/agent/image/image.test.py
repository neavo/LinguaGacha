"""像素责任的独立边界，不读取内置技能或历史漫画夹具。"""

import importlib.util
import sys
import tempfile
from pathlib import Path
import numpy as np
import cv2

spec = importlib.util.spec_from_file_location(
    "image_runtime", Path(sys.argv[1]) / "image.py"
)
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)

raw = np.zeros((1, 39, 3), np.float32)
raw[0, :4] = np.array([[16, 16, 10, 10]] * 3).T
raw[0, 4, :2], raw[0, 5, 2], raw[0, 7, :] = [0.9, 0.8], 0.7, 1
proto = np.ones((1, 32, 8, 8), np.float32)
boxes, _ = image.postprocess(raw, proto, (32, 32), (32, 32))
assert len(boxes) == 2 and set(boxes[:, 5]) == {0, 1}
raw[0, 4:7] = 0
assert len(image.postprocess(raw, proto, (32, 32), (32, 32))[0]) == 0

original = np.full((120, 120, 3), 80, np.uint8)
cv2.circle(original, (60, 60), 42, (230, 230, 230), -1)
cv2.putText(original, "A", (48, 70), 0, 0.7, (0, 0, 0), 2)
hint = np.int32([[42, 35], [78, 35], [78, 85], [42, 85]])
for mode in ("basic", "solid"):
    mask, reason = image.extract_fill(original, hint, np.array([230, 230, 230]), mode)
    assert reason == "accepted" and mask[60, 60] and not mask[5, 5]
    mask, _ = image.extract_fill(
        np.full_like(original, 230), hint, np.array([230, 230, 230]), mode
    )
    assert mask is None

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source = image.save(root / "source.png", original)
    base = image.save(root / "base.png", np.full_like(original, 255))
    mask = image.save(root / "mask.png", np.full(original.shape[:2], 255, np.uint8))
    output = root / "result.png"
    image.composite(
        dict(
            source=source,
            base=base,
            output=str(output),
            groups=[dict(accepted=False, mask=mask, tiles=[])],
        ),
        None,
    )
    assert np.array_equal(image.read_image(output), original), (
        "failed group must restore all source pixels"
    )
    image.composite(
        dict(
            source=source,
            base=base,
            output=str(output),
            groups=[dict(accepted=True, mask=mask, tiles=[])],
        ),
        None,
    )
    assert np.all(image.read_image(output) == 255), (
        "completed empty translation still applies erase decision"
    )
assert image.estimate(np.full((50, 50, 3), 255, np.uint8))["status"] == "uncertain"
print("image pixel boundaries passed")
