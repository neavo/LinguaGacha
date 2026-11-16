"""无需模型的气泡选区、填色和通道边界测试。"""
import concurrent.futures
import json
import base64
import math
import tempfile
from pathlib import Path

import cv2
import numpy as np
from lg.image import helper as image


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
        if kind == "inpaint":
            output = np.full((1, 3, *tensor.shape[2:]), .25, np.float32)
            future = concurrent.futures.Future()
            future.set_result(({"shapes": [list(output.shape)]}, output.tobytes()))
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
    assert all(region["kind"] == "bubble" for region in prep["draftRegions"])
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
    assert all("box" in box and "ownerRegionId" in box for box in empty_prep["textBoxes"])
    assert np.array_equal(image.read_image(empty_prep["fillPreview"]), source)
    # 重叠文字框仍全部排除；无背景样本保留为待确认修复候选。
    assert all(c["background"]["samplePixels"] == 0 and "color" not in c for c in covered["candidates"])
    assert all(r["disposition"] == "translate" and r["backgroundColor"] is None for r in covered["draftRegions"])
    assert np.array_equal(image.read_image(covered["fillPreview"]), source)
    page = dict(pageId="p1", width=120, height=80, regions=[prep["draftRegions"][0]])
    run = image.erase_candidates(dict(source=src, root=str(root), page=page,
                                       output=str(root / "run"), fillRegionIds=["r0001"]), Channel())
    assert len(run["regions"]) == 1 and len(run["regions"][0]["candidates"]) == 1
    assert run["regions"][0]["candidates"][0]["method"] == "fill"
    assert run["materials"]
    candidate = run["regions"][0]["candidates"][0]
    composed = image.compose_candidates(
        dict(source=src, workspaceRoot=str(root), root=str(root), page=page,
             output=str(root / "composed"),
             selected=[dict(regionId="r0001", disposition="translate", candidate=candidate)]), None)
    clean = image.read_image(composed["clean"])
    actual = cv2.imdecode(np.fromfile(composed["regions"][0]["mask"], np.uint8), cv2.IMREAD_GRAYSCALE)
    assert np.array_equal(clean[actual == 0], source[actual == 0])
    candidate["cropSha256"] = "0" * 64
    fails(lambda: image.compose_candidates(
        dict(source=src, workspaceRoot=str(root), root=str(root), page=page,
             output=str(root / "tampered"),
             selected=[dict(regionId="r0001", disposition="translate", candidate=candidate)]), None), "digest")

    boxes = [[[70, 10], [90, 10], [90, 25], [70, 25]]]
    empty_page = dict(pageId="u", width=120, height=80, regions=[])
    registered = image.register_regions(
        dict(source=src, root=str(root), output=str(root / "registered"), page=empty_page,
             textBoxes=boxes, groups=[dict(regionId="u1", textBoxIds=[0])]), None)
    assert registered["regions"][0]["kind"] == "unframed"
    fails(lambda: image.register_regions(
        dict(source=src, root=str(root), output=str(root / "overlap"), page=empty_page,
             textBoxes=boxes, groups=[dict(regionId="u1", textBoxIds=[0]),
                                      dict(regionId="u2", textBoxIds=[0])]), None), "overlap")

    # 非方形小图放大且仅补至 stride；空检测仍产出无改动底图。
    tensor = image.model_input(source)
    assert all(side % image.MODEL_STRIDE == 0 for side in tensor.shape[2:])
    assert max(tensor.shape[2:]) > max(source.shape[:2])
    assert tensor.dtype == np.float32 and tensor.min() >= 0 and tensor.max() <= 1

# 两个区域分别验证填色、LaMa 与区域顺序独立。
source = np.full((60, 100, 3), 240, np.uint8)
cv2.rectangle(source, (5, 5), (25, 35), (15, 15, 15), 3)
source[5:35, 45:49] = 15
source[31:35, 45:75] = 15
source[5:35, 71:75] = 15
selection = np.zeros(source.shape[:2], np.uint8)
selection[1:55, 1:95] = 255
boxes = [np.array([[1, 1], [94, 1], [94, 54], [1, 54]])]
with tempfile.TemporaryDirectory(prefix="lg-image-repair-") as folder:
    root = Path(folder)
    src = image.save(root / "source.png", source)
    masks = [selection.copy(), np.zeros_like(selection)]
    masks[0][:, 40:] = 0
    masks[1][1:55, 40:95] = 255
    regions = []
    for i, selected in enumerate(masks):
        member = f"masks/p1/r{i}.png"
        target = image.save(root / member, selected)
        regions.append(dict(regionId=f"r{i}", kind="bubble", disposition="translate",
                            backgroundColor=[230, 220, 210], direction="vertical-rl",
                            selection=dict(path=member, sha256=image.file_sha256(target))))
    page = dict(pageId="p1", width=100, height=60, regions=regions)
    old_boxes = image.text_detection.det_boxes
    old_text_mask = image.repair.text_mask
    image.text_detection.det_boxes = lambda *args, **kwargs: boxes
    try:
        args = dict(root=str(root), source=src, page=page, output=str(root / "first"))
        channel = Channel()
        result = image.erase_candidates({**args, "fillRegionIds": ["r0"]}, channel)
        methods = [[candidate["method"] for candidate in region["candidates"]] for region in result["regions"]]
        assert methods[0][0] == "fill" and "strokes" in methods[0]
        assert "boxes" in methods[0], "Equal masks must retain different fill and LaMa results"
        assert methods[1][0] == "strokes" and channel.requests[0] == "text"
        selected = [dict(regionId=region["regionId"], disposition="translate", candidate=region["candidates"][0])
                    for region in result["regions"]]
        composed = image.compose_candidates(dict(root=str(root), workspaceRoot=str(root), source=src,
                                                  page=page, output=str(root / "composed"),
                                                  selected=selected), None)
        clean = image.read_image(composed["clean"])
        actual = [cv2.imread(r["mask"], cv2.IMREAD_GRAYSCALE) for r in composed["regions"]]
        assert np.array_equal(actual[0], masks[0])
        assert np.count_nonzero(actual[1]) < np.count_nonzero(masks[1])
        assert np.all(clean[actual[1] > 0] == 64)
        assert np.array_equal(clean[(actual[0] | actual[1]) == 0], source[(actual[0] | actual[1]) == 0])
        page["regions"].reverse()
        reordered = image.erase_candidates({**args, "output": str(root / "reordered"),
                                             "fillRegionIds": ["r0"]}, Channel())
        assert {r["regionId"]: [c["method"] for c in r["candidates"]] for r in result["regions"]} == \
               {r["regionId"]: [c["method"] for c in r["candidates"]] for r in reordered["regions"]}
        # 相同 LaMa 掩码只推理一次，填色仍保留独立候选。
        image.repair.text_mask = lambda source, selected, boxes: image._box_mask(selected.shape, selected, boxes)
        channel = Channel()
        deduplicated = image.erase_candidates({**args, "output": str(root / "deduplicated"),
                                               "fillRegionIds": ["r0"]}, channel)
        assert channel.requests.count("inpaint") == len(regions), "Duplicate LaMa masks must share inference"
        assert len(next(r for r in deduplicated["regions"] if r["regionId"] == "r0")["candidates"]) == 2
    finally:
        image.text_detection.det_boxes = old_boxes
        image.repair.text_mask = old_text_mask


with tempfile.TemporaryDirectory(prefix="lg-image-text-pixels-") as folder:
    root = Path(folder)
    source = np.full((40, 50, 3), (130, 170, 230), np.uint8)
    src = image.save(root / "clean.png", source)
    mask = np.zeros((40, 50), np.uint8)
    mask[3:37, 4:46] = 255
    mask_file = root / "masks/p1/r1.png"
    image.save(mask_file, mask)
    region = dict(regionId="r1", kind="bubble", disposition="translate", selection=dict(path="masks/p1/r1.png", sha256=image.file_sha256(mask_file)), direction="horizontal-tb", backgroundColor=[230, 170, 130])
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
    page = dict(pageId="p", original="original.png",width=160,height=100,regions=[dict(regionId="r",kind="bubble",disposition="translate",direction="horizontal-tb",selection=dict(path="mask.png",sha256=image.file_sha256(root/"mask.png")))])
    args = dict(root=str(root),page=page,output=str(root/"plan"),maximumPixels=1000000)
    plan = image.text_plan(args,None)
    assert plan == image.text_plan(args,None)
    assert plan[0]["recommendedCandidateId"] == "C1"
    assert 2 <= len(plan[0]["candidates"]) <= image.PARTITION_RULES["max_candidates"] + 1
    page["regions"][0]["kind"] = "unframed"
    assert len(image.text_plan(args,None)[0]["candidates"]) == 1
    page["regions"][0]["kind"] = "bubble"
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
print(json.dumps({"ok": True, "checks": "region ownership, candidate bounds, compose, text geometry, partition coverage, budget and tampering"}))
