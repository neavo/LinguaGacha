"""使用自有像素与推理替身验证笔画填孔、边界和混合消字，无需权重。"""
import concurrent.futures
import importlib.util
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("image_runtime", Path(sys.argv[1]) / "image.py")
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)
repair = image.repair

# 同一轮廓中的封闭孔洞填满，开口凹陷与分离字符之间仍保留背景。
outline = np.zeros((60, 100), np.uint8)
cv2.rectangle(outline, (5, 5), (25, 35), 255, 3)
outline[5:35, 45:49] = 255
outline[31:35, 45:75] = 255
outline[5:35, 71:75] = 255
filled = repair.fill_holes(outline)
assert filled[20, 15] == 255 and filled[20, 60] == 0 and filled[20, 35] == 0
assert np.all(filled[outline > 0] == 255)

source = np.full((60, 100, 3), 240, np.uint8)
source[outline > 0] = 15
selection = np.zeros_like(outline)
selection[1:55, 1:95] = 255
boxes = [np.array([[1, 1], [94, 1], [94, 54], [1, 54]])]
mask = repair.text_mask(source, selection, boxes)
assert mask[20, 15] == 255 and mask[20, 60] == 0
assert np.all(mask[outline > 0] == 255) and not np.any(mask[selection == 0])
try:
    repair.text_mask(source, selection, [])
except ValueError as error:
    assert "Empty repair mask" in str(error)
else:
    raise AssertionError("Empty masks must fail")


class Channel:
    """记录修复链发出的模型请求，并返回固定像素结果。"""
    def __init__(self):
        """初始化请求序列。"""
        self.calls = []

    def request(self, kind, tensor):
        """按请求类型返回文字概率图或 LaMa 输出。"""
        self.calls.append(kind)
        future = concurrent.futures.Future()
        if kind == "text":
            output = np.zeros(tensor.shape[2:], np.float32)
        else:
            assert kind == "inpaint" and tensor.shape[1] == 4
            assert tensor.shape[2] % 64 == tensor.shape[3] % 64 == 0
            assert set(np.unique(tensor[:, 3])) <= {0, 1}
            output = np.full((1, 3, *tensor.shape[2:]), .25, np.float32)
        future.set_result(({"shapes": [list(output.shape)]}, output.tobytes()))
        return future


with tempfile.TemporaryDirectory(prefix="lg-image-repair-") as folder:
    root = Path(folder)
    src = image.save(root / "source.png", source)
    masks = [selection.copy(), np.zeros_like(selection)]
    masks[0][:, 40:] = 0
    masks[1][1:55, 40:95] = 255
    regions = []
    for i, (selected, method) in enumerate(zip(masks, ("fill", "inpaint"))):
        member = f"masks/p1/r{i}.png"
        target = image.save(root / member, selected)
        regions.append(dict(regionId=f"r{i}", disposition="translate", eraseMethod=method,
                            backgroundColor=[230, 220, 210], direction="vertical-rl",
                            selection=dict(path=member, sha256=image.file_sha256(target))))
    page = dict(pageId="p1", width=100, height=60, regions=regions)
    old_boxes = image.text_detection.det_boxes
    image.text_detection.det_boxes = lambda *args, **kwargs: boxes
    try:
        args = dict(root=str(root), source=src, page=page, output=str(root / "first"))
        channel = Channel()
        result = image.erase(args, channel)
        assert channel.calls == ["text", "inpaint"]
        clean = image.read_image(result["clean"])
        actual = [cv2.imread(r["mask"], cv2.IMREAD_GRAYSCALE) for r in result["regions"]]
        assert np.array_equal(actual[0], masks[0])
        assert np.count_nonzero(actual[1]) < np.count_nonzero(masks[1])
        assert np.all(clean[actual[1] > 0] == 64)
        assert np.array_equal(clean[(actual[0] | actual[1]) == 0], source[(actual[0] | actual[1]) == 0])
        page["regions"].reverse()
        reordered = image.erase({**args, "output": str(root / "reordered")}, Channel())
        assert np.array_equal(clean, image.read_image(reordered["clean"]))
    finally:
        image.text_detection.det_boxes = old_boxes

print("repair: filled holes, open gaps, selection bounds, empty masks, mixed methods and order independence passed")
