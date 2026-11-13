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

# 验证 YOLO 后处理筛选多类别与空置信度过滤。
raw = np.zeros((1, 39, 3), np.float32)
raw[0, :4] = np.array([[16, 16, 10, 10]] * 3).T
raw[0, 4, :2], raw[0, 5, 2], raw[0, 7, :] = [0.9, 0.8], 0.7, 1
proto = np.ones((1, 32, 8, 8), np.float32)
boxes, _ = image.postprocess(raw, proto, (32, 32), (32, 32))
assert len(boxes) == 2 and set(boxes[:, 5]) == {0, 1}
raw[0, 4:7] = 0
assert len(image.postprocess(raw, proto, (32, 32), (32, 32))[0]) == 0

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    # 校验白底黑字触边、有色纸纹和暗底白字三类气泡的纯色直填、框线保留及字体取色。
    for name, bg, fg in [
        ("edge", [255] * 3, [0] * 3),
        ("paper", [140, 190, 215], [10] * 3),
        ("dark", [20] * 3, [240] * 3),
    ]:
        original = np.full((120, 240, 3), bg, np.uint8)
        cv2.putText(original, "ABC", (20, 70), 0, 0.9, fg, 2)
        if name == "edge":
            cv2.line(original, (0, 0), (0, 119), (0, 0, 0), 3)
            cv2.fillPoly(
                original,
                [np.int32([[100, 119], [119, 100], [119, 119]])],
                (40, 70, 100),
            )
        bbox = dict(x=0, y=0, width=120, height=120)
        mask, background, ink, spread, _ = image.extract_stroke_and_style(original, bbox)
        assert mask.any() and spread <= image.BACKGROUND_SPREAD
        assert np.array_equal(background, bg) and np.array_equal(ink, fg)
        source = image.save(root / f"{name}.png", original)
        page = dict(
            width=240,
            height=120,
            regions=[
                dict(
                    regionId="a",
                    disposition="translate",
                    bbox=bbox,
                    direction="horizontal-tb",
                )
            ],
        )
        repaired = image.repair(
            dict(source=source, page=page, output=str(root / name)), None
        )
        base = image.read_image(repaired["base"])
        assert np.all(base[mask > 0] == bg)
        assert np.array_equal(base[mask == 0], original[mask == 0])
        if name == "edge":
            assert np.array_equal(base[:, :3], original[:, :3]), (
                "page-edge frame must survive"
            )
            assert np.array_equal(base[100:, 100:120], original[100:, 100:120]), (
                "background corner must survive"
            )
        layout = image.layout(dict(source=source, page=page), None)
        assert layout[0]["style"]["color"] == "#" + "".join(
            f"{c:02x}" for c in fg[::-1]
        )
        assert layout[0]["style"]["fontSize"] >= 8

    # 验证多区域独立合成：未接受区域保持原图，已接受空译文区域仅擦除自身笔画。
    original = np.full((120, 240, 3), 255, np.uint8)
    cv2.putText(original, "A", (25, 70), 0, 1, (0, 0, 0), 2)
    cv2.putText(original, "B", (145, 70), 0, 1, (0, 0, 0), 2)
    source = image.save(root / "two.png", original)
    page = dict(
        width=240,
        height=120,
        regions=[
            dict(
                regionId=str(i),
                disposition="translate",
                bbox=dict(x=i * 120, y=0, width=120, height=120),
            )
            for i in range(2)
        ],
    )
    repaired = image.repair(
        dict(source=source, page=page, output=str(root / "two")), None
    )
    output = root / "result.png"
    image.composite(
        dict(
            source=source,
            base=repaired["base"],
            output=str(output),
            regions=[
                dict(**r, accepted=i == 1, tiles=[])
                for i, r in enumerate(repaired["regions"])
            ],
        ),
        None,
    )
    result = image.read_image(output)
    assert np.array_equal(result[:, :120], original[:, :120])
    assert np.all(result[:, 120:] == 255), (
        "completed empty translation erases only its own region"
    )

    # 彩色渐变背景经真实修复入口，替身只提供推理，验证传入的是稀疏笔画掩码。
    gradient = np.linspace(160, 255, 120).astype(np.uint8)
    original = np.repeat(np.tile(gradient, (120, 1))[:, :, None], 3, axis=2)
    cv2.putText(original, "TEXT", (10, 65), 0, 0.8, (0, 0, 0), 2)
    source = image.save(root / "gradient.png", original)
    page = dict(
        width=120,
        height=120,
        regions=[
            dict(
                regionId="gradient",
                disposition="translate",
                bbox=dict(x=0, y=0, width=120, height=120),
            )
        ],
    )
    calls = []

    def forward(channel, kind, data):
        assert kind == "inpaint"
        assert 0 < np.count_nonzero(data[0, 3]) < data[0, 3].size / 2
        calls.append(kind)
        return [data[:, :3]]

    image.forward = forward
    image.repair(dict(source=source, page=page, output=str(root / "gradient")), None)
    assert calls == ["inpaint"]

    # 有色/半透明气泡白边黑字：必须整块走纯色直填（不进 LaMa），且白边与黑芯一并清除。
    halo_bg = [135, 230, 250]
    original = np.full((140, 140, 3), halo_bg, np.uint8)
    cv2.putText(original, "HI", (36, 82), 0, 1.3, (255, 255, 255), 8)
    cv2.putText(original, "HI", (36, 82), 0, 1.3, (0, 0, 0), 3)
    halo_bbox = dict(x=0, y=0, width=140, height=140)
    mask, background, ink, spread, _ = image.extract_stroke_and_style(
        original, halo_bbox
    )
    assert spread <= image.BACKGROUND_SPREAD
    assert np.array_equal(background, halo_bg)
    assert np.array_equal(ink, [0, 0, 0])
    white_halo = np.all(original == 255, axis=2)
    black_core = np.all(original == 0, axis=2)
    assert np.all(mask[white_halo] > 0) and np.all(mask[black_core] > 0)
print("image pixel boundaries passed")
