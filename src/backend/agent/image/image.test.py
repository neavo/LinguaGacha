"""无需模型的气泡选区、填色和通道边界测试；第二个参数可指向部署 runtime。"""
import concurrent.futures
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("image_runtime", Path(sys.argv[1]) / "image.py")
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)


def fails(call, message):
    """要求指定边界明确失败，避免其它异常掩盖测试目标。"""
    try:
        call()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError(f"Expected {message}")


class Channel:
    """替代模型传输，保留真实的张量解码与像素计算。"""
    def request(self, kind, tensor):
        """返回两个重叠实例，验证稳定归属而非模型质量。"""
        assert kind == "bubble"
        h, w = tensor.shape[2:]
        n = 21 * (h // 32) * (w // 32)
        raw = np.zeros((1, 37, n), np.float32)
        # 两个重叠但不触发 NMS 的容器，分数决定唯一像素归属。
        raw[0, :5, 0] = [w * .4, h * .5, w * .6, h * .8, .9]
        raw[0, :5, 1] = [w * .65, h * .5, w * .5, h * .8, .8]
        raw[0, 5, :2] = 1
        proto = np.ones((1, 32, h // 4, w // 4), np.float32)
        future = concurrent.futures.Future()
        future.set_result(({"shapes": [list(raw.shape), list(proto.shape)]}, raw.tobytes() + proto.tobytes()))
        return future


with tempfile.TemporaryDirectory(prefix="lg-image-pixels-") as folder:
    root = Path(folder)
    source = np.full((80, 120, 3), (30, 190, 240), np.uint8)
    source[30:50, 35:55] = 0  # 内部文字与装饰同样被覆盖。
    src = image.save(root / "source.png", source)
    prep = image.prepare(dict(source=src, output=str(root / "evidence"), selectionRoot=str(root), pageId="p1"), Channel())
    assert len(prep["draftRegions"]) == 2
    assert prep["candidates"][1]["overlaps"] == ["r0001"]
    page = dict(pageId="p1", width=120, height=80, regions=prep["draftRegions"])
    page["regions"][0]["fill"]["color"] = [240, 190, 30]
    page["regions"][1]["fill"]["color"] = [255, 255, 255]
    args = dict(source=src, root=str(root), page=page, output=str(root / "run"))
    result = image.erase(args, None)
    clean = image.read_image(result["clean"])
    masks = [image.read_selection(root / r["selection"]["path"], r["selection"], (80, 120)) for r in page["regions"]]
    union = masks[0] | masks[1]
    assert not np.any(masks[0] & masks[1])
    assert np.array_equal(clean[union == 0], source[union == 0])
    assert np.all(clean[masks[0] > 0] == (30, 190, 240))
    assert np.all(clean[masks[1] > 0] == 255)
    page["regions"].reverse()
    reordered = image.erase({**args, "output": str(root / "reordered")}, None)
    assert np.array_equal(clean, image.read_image(reordered["clean"]))
    kept = page["regions"][0]
    kept["disposition"], kept["preserveReason"] = "preserve", "intentional"
    preserved = image.read_image(image.erase({**args, "output": str(root / "preserved")}, None)["clean"])
    assert np.array_equal(preserved[masks[1] > 0], source[masks[1] > 0])
    page["regions"].append(dict(regionId="missed", disposition="preserve", preserveReason="repair_failed", selection=None, fill=None, direction=None))
    image.erase({**args, "output": str(root / "missing")}, None)
    translated = page["regions"][1]
    translated["fill"]["color"] = [256, 0, 0]
    fails(lambda: image.erase(args, None), "RGB")
    translated["fill"]["color"] = [255, 0, 0]
    mask_path = root / translated["selection"]["path"]
    image.save(mask_path, np.full((80, 120), 128, np.uint8))
    fails(lambda: image.erase(args, None), "digest")
    translated["selection"]["sha256"] = image.file_sha256(mask_path)
    fails(lambda: image.erase(args, None), "binary")

    ring = np.zeros((30, 30), np.uint8)
    ring[3:27, 3:27] = 255
    ring[10:20, 10:20] = 0
    inset = image.inset_selection(ring)
    assert inset[15, 15] == 255 and inset[3, 3] == 0
    dot = np.zeros_like(ring)
    dot[10, 10] = 255
    assert not np.any(image.inset_selection(dot))
    fails(lambda: image.estimate_color(source, np.zeros((80, 120), np.uint8)), "empty_selection")
    white = np.full((30, 30, 3), (225, 230, 235), np.uint8)
    assert image.estimate_color(white, ring) == [255, 255, 255]
    assert image.estimate_color(source, masks[0]) == [240, 190, 30]

    # 非方形小图放大且仅补至 stride；空检测仍产出无改动底图。
    tensor = image.model_input(source)
    assert all(side % image.MODEL_STRIDE == 0 for side in tensor.shape[2:])
    assert max(tensor.shape[2:]) > max(source.shape[:2])
    assert tensor.dtype == np.float32 and tensor.min() >= 0 and tensor.max() <= 1
    empty = dict(pageId="empty", width=120, height=80, regions=[])
    result = image.erase({**args, "page": empty, "output": str(root / "empty")}, None)
    assert np.array_equal(source, image.read_image(result["clean"]))
    fails(lambda: list(image.postprocess(np.zeros((1, 39, 21), np.float32), np.zeros((1, 32, 8, 8), np.float32), (32, 32), (32, 32))), "shape")

print(json.dumps({"ok": True, "checks": "selection ownership, holes, RGB, fill, preserve, tampering, empty page, model boundary"}))
