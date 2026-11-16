"""用长横条验证分段、分页和原图与候选配对，不锁定布局预设。"""
import importlib.util
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("materials", Path(sys.argv[1]) / "materials.py")
materials = importlib.util.module_from_spec(spec)
spec.loader.exec_module(materials)

with tempfile.TemporaryDirectory(prefix="lg-image-materials-") as folder:
    root = Path(folder)
    original = np.zeros((40, 1200, 3), np.uint8)
    colors = [(30, 90, 180), (180, 90, 30), (90, 180, 30)]
    for index, color in enumerate(colors):
        original[:, index * 400:(index + 1) * 400] = color
    candidate = np.full_like(original, (200, 30, 100))
    for name, pixels in (("original", original), ("candidate", candidate)):
        cv2.imencode(".png", pixels)[1].tofile(str(root / f"{name}.png"))
    sheets = materials.candidate_sheets([
        dict(regionId=f"r{index}", originalCrop=root / "original.png",
             candidates=[dict(candidateId="A", crop=root / "candidate.png")])
        for index in range(4)
    ], root / "sheets")
    assert len(sheets) > 1
    images = [cv2.imdecode(np.fromfile(file, np.uint8), cv2.IMREAD_COLOR) for file in sheets]
    assert all(max(image.shape[:2]) <= materials.MAX_EDGE for image in images)
    for color in [*colors, (200, 30, 100)]:
        assert any(np.any(np.all(image == color, axis=2)) for image in images)
print("materials: bounded sheets retain original segments and candidates")
