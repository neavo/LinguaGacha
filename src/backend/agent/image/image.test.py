"""无需模型的气泡选区、填色和通道边界测试；第二个参数可指向部署 runtime。"""
import concurrent.futures
import importlib.util
import json
import base64
import math
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
    def __init__(self, empty=False):
        """记录实际请求，区分空选区与文字检测返回零框。"""
        self.empty = empty
        self.requests = []

    def request(self, kind, tensor):
        """返回两个重叠实例，验证稳定归属而非模型质量。"""
        self.requests.append(kind)
        if kind == "text":
            probability = np.zeros(tensor.shape[2:], np.float32)
            future = concurrent.futures.Future()
            future.set_result(({"shapes": [list(probability.shape)]}, probability.tobytes()))
            return future
        assert kind == "bubble"
        h, w = tensor.shape[2:]
        n = 21 * (h // 32) * (w // 32)
        raw = np.zeros((1, 37, n), np.float32)
        # 两个重叠但不触发 NMS 的容器，分数决定唯一像素归属。
        raw[0, :5, 0] = [w * .4, h * .5, w * .6, h * .8, .9]
        raw[0, :5, 1] = [w * .65, h * .5, w * .5, h * .8, .8]
        if self.empty:
            raw[0, 4] = 0
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
    original_boxes = image.text_detection.det_boxes
    image.text_detection.det_boxes = lambda *args, **kwargs: [np.array([[0,0],[119,0],[119,79],[0,79]])] * 2
    try:
        empty_channel = Channel(empty=True)
        empty_prep = image.prepare(dict(source=src, output=str(root / "empty-prep"), selectionRoot=str(root / "empty-prep"), pageId="p1"), empty_channel)
        covered = image.prepare(dict(source=src, output=str(root / "text-covered"), selectionRoot=str(root / "text-covered"), pageId="p1"), Channel())
    finally:
        image.text_detection.det_boxes = original_boxes
    assert empty_channel.requests == ["bubble", "text"] and empty_prep["draftRegions"] == []
    assert len(empty_prep["textBoxes"]) == 2
    assert np.array_equal(image.read_image(empty_prep["fillPreview"]), source)
    # 重叠文字框仍全部排除；无背景样本保留为待确认修复候选。
    assert all(c["background"]["samplePixels"] == 0 and "color" not in c for c in covered["candidates"])
    assert all(r["disposition"] == "translate" and r["eraseMethod"] == "inpaint" and r["backgroundColor"] is None for r in covered["draftRegions"])
    assert np.array_equal(image.read_image(covered["fillPreview"]), source)
    page = dict(pageId="p1", width=120, height=80, regions=prep["draftRegions"])
    initial = image.erase(dict(source=src, root=str(root), page=page, output=str(root / "initial")), None)
    assert np.array_equal(image.read_image(prep["fillPreview"]), image.read_image(initial["clean"]))
    page["regions"][0]["backgroundColor"] = [240, 190, 30]
    page["regions"][1]["backgroundColor"] = [255, 255, 255]
    args = dict(source=src, root=str(root), page=page, output=str(root / "run"))
    result = image.erase(args, None)
    clean = image.read_image(result["clean"])
    masks = [image.read_selection(root / r["selection"]["path"], r["selection"], (80, 120)) for r in page["regions"]]
    union = masks[0] | masks[1]
    assert not np.any(masks[0] & masks[1])
    assert np.array_equal(clean[union == 0], source[union == 0])
    interior = cv2.distanceTransform(union, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) >= 1.5
    assert np.all(clean[(masks[0] > 0) & interior] == (30, 190, 240))
    assert np.all(clean[(masks[1] > 0) & interior] == 255)
    page["regions"].reverse()
    reordered = image.erase({**args, "output": str(root / "reordered")}, None)
    assert np.array_equal(clean, image.read_image(reordered["clean"]))
    kept = page["regions"][0]
    kept["disposition"], kept["preserveReason"] = "preserve", "intentional"
    kept["eraseMethod"], kept["backgroundColor"], kept["direction"] = None, None, None
    preserved = image.read_image(image.erase({**args, "output": str(root / "preserved")}, None)["clean"])
    assert np.array_equal(preserved[masks[1] > 0], source[masks[1] > 0])
    page["regions"].append(dict(regionId="missed", disposition="preserve", preserveReason="repair_failed", selection=None, eraseMethod=None, backgroundColor=None, direction=None))
    image.erase({**args, "output": str(root / "missing")}, None)
    translated = page["regions"][1]
    translated["backgroundColor"] = [256, 0, 0]
    fails(lambda: image.erase(args, None), "RGB")
    translated["backgroundColor"] = [255, 0, 0]
    mask_path = root / translated["selection"]["path"]
    image.save(mask_path, cv2.erode(masks[0], np.ones((3, 3), np.uint8)))  # 合法二值图也不能替换已确认选区。
    fails(lambda: image.erase(args, None), "digest")
    image.save(mask_path, np.full((80, 120), 128, np.uint8))
    translated["selection"]["sha256"] = image.file_sha256(mask_path)
    fails(lambda: image.erase(args, None), "binary")

    # 非方形小图放大且仅补至 stride；空检测仍产出无改动底图。
    tensor = image.model_input(source)
    assert all(side % image.MODEL_STRIDE == 0 for side in tensor.shape[2:])
    assert max(tensor.shape[2:]) > max(source.shape[:2])
    assert tensor.dtype == np.float32 and tensor.min() >= 0 and tensor.max() <= 1
    empty = dict(pageId="empty", width=120, height=80, regions=[])
    result = image.erase({**args, "page": empty, "output": str(root / "empty")}, None)
    assert np.array_equal(source, image.read_image(result["clean"]))

with tempfile.TemporaryDirectory(prefix="lg-image-text-pixels-") as folder:
    root = Path(folder)
    source = np.full((40, 50, 3), (130, 170, 230), np.uint8)
    src = image.save(root / "clean.png", source)
    mask = np.zeros((40, 50), np.uint8)
    mask[3:37, 4:46] = 255
    mask_file = root / "masks/p1/r1.png"
    image.save(mask_file, mask)
    region = dict(regionId="r1", disposition="translate", selection=dict(path="masks/p1/r1.png", sha256=image.file_sha256(mask_file)), direction="horizontal-tb", eraseMethod="fill", backgroundColor=[230, 170, 130])
    page = dict(pageId="p1", width=50, height=40, regions=[region])
    selected = [dict(regionId="r1",candidateId="C0",blocks=[dict(blockId="B1",box=[4,3,42,34],selection=region["selection"])])]
    args = dict(root=str(root), page=page, selected=selected, materials=str(root))
    geometry = image.text_geometry(args, None)[0]
    x, y, w, h = geometry["box"]
    assert geometry["centroid"] == [w/2, h/2]
    distance = np.frombuffer(base64.b64decode(geometry["distance"]), "<f4").reshape(h, w)
    overlay = np.zeros((h, w, 4), np.uint8)
    overlay[h//2-1:h//2+1, w//2-1:w//2+1] = (255, 255, 255, 128)
    covered = overlay[:, :, 3] > 0
    result = dict(regionId="r1", blockId="B1", text="字", box=geometry["box"], status="rendered", fontSize=2,
                  margin=float(distance[covered].min()-math.sqrt(2)), bounds=[x+w//2-1,y+h//2-1,x+w//2+1,y+h//2+1], centerError=0)
    paint_file = root / "paint.json"
    def write_paint():
        """每个反例只改变其所验证的边界。"""
        encoded = cv2.imencode(".png", overlay)[1]
        paint_file.write_text(json.dumps(dict(regions=[dict(result=result, png=base64.b64encode(encoded).decode("ascii"))])), encoding="utf-8")
    write_paint()
    compose = dict(**args, source=src, paint=str(paint_file), output=str(root/"preview.png"), rules=dict(minimumMargin=2, marginRatio=.35, minimumCenterTolerance=1, centerToleranceRatio=.4))
    composite = image.read_image(image.text_compose(compose, None)["preview"])
    assert np.array_equal(composite[mask == 0], source[mask == 0])
    assert np.any(composite != source)
    result["bounds"][0] += 1
    write_paint()
    fails(lambda: image.text_compose(compose, None), "metrics mismatch")
    result["bounds"][0] -= 1
    overlay[0, 0] = (0, 0, 0, 1)
    write_paint()
    fails(lambda: image.text_compose(compose, None), "margin")

with tempfile.TemporaryDirectory(prefix="lg-image-partition-") as folder:
    root = Path(folder)
    mask = np.zeros((100,160),np.uint8)
    cv2.circle(mask,(40,50),30,255,-1)
    cv2.circle(mask,(120,50),30,255,-1)
    cv2.rectangle(mask,(40,45),(120,55),255,-1)
    image.save(root/"mask.png",mask)
    image.save(root/"original.png",np.full((100,160,3),255,np.uint8))
    page = dict(pageId="p", original="original.png",width=160,height=100,regions=[dict(regionId="r",disposition="translate",direction="horizontal-tb",selection=dict(path="mask.png",sha256=image.file_sha256(root/"mask.png")))])
    args = dict(root=str(root),page=page,output=str(root/"plan"),maximumPixels=1000000)
    plan = image.text_plan(args,None)
    assert plan == image.text_plan(args,None)
    assert plan[0]["recommendedCandidateId"] == "C1"
    assert 2 <= len(plan[0]["candidates"]) <= image.PARTITION_RULES["max_candidates"] + 1
    for candidate in plan[0]["candidates"]:
        selected = [dict(regionId="r",**candidate)]
        geometry = image.text_geometry(dict(root=str(root),page=page,materials=str(root/"plan"),selected=selected),None)
        assert len(geometry) == len(candidate["blocks"])
    fails(lambda: image.text_plan(dict(args,maximumPixels=1),None),"budget")
    ellipse = np.zeros((100,100),np.uint8)
    cv2.ellipse(ellipse,(50,50),(30,40),0,0,360,1,-1)
    assert image.partition_candidates(ellipse) == []
    candidate = plan[0]["candidates"][1]
    file = root/"plan"/candidate["blocks"][0]["selection"]["path"]
    file.write_bytes(b"corrupted")
    fails(lambda: image.text_geometry(dict(root=str(root),page=page,materials=str(root/"plan"),selected=[dict(regionId="r",**candidate)]),None),"digest")
print(json.dumps({"ok": True, "checks": "selection, fill, preserve, model boundary, text geometry, compositing, partition coverage, determinism, budget and tampering"}))
