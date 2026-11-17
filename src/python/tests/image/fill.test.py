"""无模型验证背景分流、边框保护与填色并集。"""

import cv2
import numpy as np
from lg.image import fill

# 排除文字框后保留暖底色；零框按完整选区统计，空样本明确停止。
source = np.full((10, 10, 3), (225, 230, 235), np.uint8)
source[:3] = 0
selection = np.full((10, 10), 255, np.uint8)
text = np.zeros_like(selection)
background, color = fill.analyze_background(source, selection, text)
assert background == dict(route="model", coverage=0.7, samplePixels=100)
assert color == [235, 230, 225]
text[:3] = 255
background, color = fill.analyze_background(source, selection, text)
assert background == dict(route="fill", coverage=1, samplePixels=70)
assert color == [235, 230, 225]
assert fill.analyze_background(source, selection, selection) == (
    dict(route="model", coverage=None, samplePixels=0),
    None,
)
for dark_pixels, route in ((20, "fill"), (21, "model")):
    source[:] = 255
    source.reshape(-1, 3)[:dark_pixels] = 0
    assert (
        fill.analyze_background(source, selection, np.zeros_like(text))[0]["route"]
        == route
    )

ring = np.zeros((30, 30), np.uint8)
ring[3:27, 3:27] = 255
ring[10:20, 10:20] = 0
inset = fill.inset_selection(ring)
assert inset[15, 15] == 255 and not np.any(inset[3:5])
dot = np.zeros_like(ring)
dot[10, 10] = 255
assert not np.any(fill.inset_selection(dot))

# 邻接区域使用不同色值，内部接缝仍不能混回原字。
source = np.zeros((12, 16, 3), np.uint8)
left = np.zeros(source.shape[:2], np.uint8)
right = left.copy()
left[2:10, 2:8] = 255
right[2:10, 8:14] = 255
regions = [(left, [200, 180, 160]), (right, [240, 220, 200])]
result = fill.render_fill(source, iter(regions))
assert np.all(result[4:8, 7] == [160, 180, 200])
assert np.all(result[4:8, 8] == [200, 220, 240])
assert np.array_equal(result[2, 5], [80, 90, 100])
assert np.array_equal(result[(left | right) == 0], source[(left | right) == 0])
assert np.array_equal(result, fill.render_fill(source, reversed(regions)))
assert np.array_equal(fill.render_fill(source, []), source)

# 触页边不补零，全页选区没有人为边缘过渡。
edge = np.zeros_like(left)
edge[:8, :8] = 255
result = fill.render_fill(source, [(edge, [255, 255, 255])])
assert np.all(result[0, 0] == 255) and np.all(result[7, 3] == 128)
assert np.all(
    fill.render_fill(source, [(np.full_like(left, 255), [255, 255, 255])]) == 255
)
print("fill: background routing, inset, union transition and page edges passed")
