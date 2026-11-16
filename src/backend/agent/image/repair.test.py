"""使用自有像素验证笔画填孔、选区边界和 LaMa 张量，无需权重。"""
import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("repair", Path(sys.argv[1]) / "repair.py")
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

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


# 用公开 inpaint 入口验证模型张量和掩码像素回传。
def forward(tensor):
    """检查 LaMa 输入协议，返回固定颜色。"""
    assert tensor.shape[1] == 4
    assert tensor.shape[2] % repair.STRIDE == tensor.shape[3] % repair.STRIDE == 0
    assert set(np.unique(tensor[:, 3])) <= {0, 1}
    return np.full((1, 3, *tensor.shape[2:]), .25, np.float32)


result = repair.inpaint(source, mask, forward)
assert result.shape == (np.count_nonzero(mask), 3) and np.all(result == 64)
print("repair: filled holes, open gaps, selection bounds and inpaint tensor passed")
