"""无需真实模型的漫画 OCR、自动分区、消字回退与输出像素测试。"""

import base64
import concurrent.futures
import json
import tempfile
from pathlib import Path

import cv2
import numpy as np
from lg.image import helper as image


def future(value):
    result = concurrent.futures.Future()
    result.set_result(value)
    return result


class Channel:
    def __init__(self, bubbles=False):
        self.bubbles = bubbles
        self.requests = []

    def request(self, kind, tensor):
        self.requests.append(kind)
        if kind == "text":
            probability = np.zeros(tensor.shape[2:], np.float32)
            return future(
                ({"shapes": [list(probability.shape)]}, probability.tobytes())
            )
        if kind == "recognition":
            return future(({"text": "原文"}, b""))
        if kind == "inpaint":
            output = np.full((1, 3, *tensor.shape[2:]), 0.25, np.float32)
            return future(({"shapes": [list(output.shape)]}, output.tobytes()))
        assert kind == "bubble"
        height, width = tensor.shape[2:]
        count = 21 * (height // 32) * (width // 32)
        raw = np.zeros((1, 37, count), np.float32)
        if self.bubbles:
            raw[0, :5, 0] = [width / 2, height / 2, width * 0.8, height * 0.8, 0.9]
            raw[0, 5, 0] = 1
        proto = np.ones((1, 32, height // 4, width // 4), np.float32)
        return future(
            (
                {"shapes": [list(raw.shape), list(proto.shape)]},
                raw.tobytes() + proto.tobytes(),
            )
        )


def box(x0, y0, x1, y1):
    points = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    return dict(box=points, coreBox=points.copy(), score=0.9)


# 整页检测只发起一次请求；相邻无框框按阅读顺序合并。
channel = Channel()
assert image.detect_text(np.zeros((1800, 1200, 3), np.uint8), channel) == []
assert channel.requests == ["text"]
groups = image.group_unframed(
    [
        {**box(70, 10, 90, 30), "text": "右"},
        {**box(45, 10, 65, 30), "text": "左"},
        {**box(5, 60, 15, 70), "text": "远"},
    ]
)
assert sorted(len(group) for group in groups) == [1, 2]
joined = next(group for group in groups if len(group) == 2)
assert image.ordered_text(joined, "vertical-rl") == "右\n左"
tilted = {**box(45, 10, 65, 30), "text": "斜"}
tilted["box"] = tilted["box"] @ np.array([[0.94, 0.34], [-0.34, 0.94]])
assert not image.adjacent_text({**box(70, 10, 90, 30), "text": "正文"}, tilted)


with tempfile.TemporaryDirectory(prefix="lg-image-create-") as folder:
    root = Path(folder)
    source = np.full((80, 120, 3), 240, np.uint8)
    source[20:35, 20:45] = 0
    source[20:35, 50:75] = 0
    source_file = image.save(root / "source.png", source)
    original_detect = image.text_detection.det_box_records
    original_recognize = image.recognize_text
    try:
        image.text_detection.det_box_records = lambda *_args, **_kwargs: [
            box(18, 18, 47, 37),
            box(48, 18, 77, 37),
        ]
        image.recognize_text = lambda _frame, points, _channel: (
            "第一" if np.asarray(points)[0, 0] < 40 else "第二"
        )
        created = image.create_page(
            dict(
                pageId="p1",
                relativePath="page.png",
                original="originals/p1.png",
                sha256="0" * 64,
                width=120,
                height=80,
                orientation=1,
                source=source_file,
            ),
            root,
            Channel(),
        )
    finally:
        image.text_detection.det_box_records = original_detect
        image.recognize_text = original_recognize
    assert len(created["page"]["textBoxes"]) == 2
    assert created["page"]["regions"][0]["kind"] == "unframed"
    assert created["records"][0]["message"] == "第一\n第二"
    assert created["clean"]["regions"][0]["status"] == "cleaned"
    assert Path(created["diagnostics"]["preview"]).is_file()

    # 笔画掩码失败直接记录回退，不尝试整框 LaMa。
    region = created["page"]["regions"][0]
    original_text_mask = image.repair.text_mask
    try:
        image.repair.text_mask = lambda *_args: (_ for _ in ()).throw(
            ValueError("no strokes")
        )
        clean, failures = image._clean_page(
            source,
            created["page"],
            root,
            {region["regionId"]: {"route": "model"}},
            Channel(),
        )
    finally:
        image.repair.text_mask = original_text_mask
    assert clean["regions"] == [{"regionId": region["regionId"], "status": "failed"}]
    assert failures == [{"regionId": region["regionId"], "error": "no strokes"}]


with tempfile.TemporaryDirectory(prefix="lg-image-output-") as folder:
    root = Path(folder)
    clean_pixels = np.full((40, 50, 3), (130, 170, 230), np.uint8)
    mask = np.zeros((40, 50), np.uint8)
    mask[3:37, 4:46] = 255
    original_pixels = clean_pixels.copy()
    original_pixels[mask > 0] = 0
    clean_file = image.save(root / "clean.png", clean_pixels)
    original_file = image.save(root / "original.png", original_pixels)
    image.save(root / "layout-areas/p1/r1.png", mask)
    image.save(root / "erase-masks/p1/r1.png", mask)
    page = dict(
        pageId="p1",
        width=50,
        height=40,
        regions=[
            dict(
                regionId="r1",
                kind="bubble",
                textBoxIds=["t1"],
                layoutArea=dict(path="layout-areas/p1/r1.png"),
                direction="horizontal-tb",
                backgroundColor=[230, 170, 130],
            )
        ],
    )
    geometry = image.text_layout(
        dict(root=str(root), page=page, maximumBytes=1_000_000), None
    )[0]["candidates"][0]["blocks"][0]
    x, y, width, height = geometry["box"]
    overlay = np.zeros((height, width, 4), np.uint8)
    overlay[height // 2, width // 2] = (255, 255, 255, 255)
    encoded = cv2.imencode(".png", overlay)[1]
    paint = root / "paint.json"
    paint.write_text(
        json.dumps(
            dict(
                regions=[
                    dict(
                        result=dict(
                            regionId="r1",
                            box=geometry["box"],
                            renderStatus="success",
                        ),
                        png=base64.b64encode(encoded).decode("ascii"),
                    )
                ]
            )
        ),
        encoding="utf-8",
    )
    compose = dict(
        root=str(root),
        page=page,
        source=clean_file,
        original=original_file,
        cleanRegions=[
            dict(
                regionId="r1",
                status="cleaned",
                eraseMask="erase-masks/p1/r1.png",
            )
        ],
        fallbackRegionIds=[],
        paint=str(paint),
        output=str(root / "preview.png"),
    )
    composed = image.read_image(image.text_compose(compose, None)["preview"])
    assert np.array_equal(composed[mask == 0], original_pixels[mask == 0])
    fallback = image.text_compose(
        {**compose, "fallbackRegionIds": ["r1"], "output": str(root / "fallback.png")},
        None,
    )
    assert np.array_equal(image.read_image(fallback["preview"]), original_pixels)
    qa = image.qa_preview(
        dict(
            root=str(root),
            page=page,
            source=compose["output"],
            entries=[
                dict(regionId="r1", status="success", output="translated", reasons=[])
            ],
            output=str(root / "qa.png"),
        ),
        None,
    )
    assert np.any(image.read_image(qa["preview"]) != composed)


with tempfile.TemporaryDirectory(prefix="lg-image-partition-") as folder:
    root = Path(folder)
    mask = np.zeros((100, 160), np.uint8)
    cv2.circle(mask, (40, 50), 30, 255, -1)
    cv2.circle(mask, (120, 50), 30, 255, -1)
    cv2.rectangle(mask, (40, 45), (120, 55), 255, -1)
    image.save(root / "mask.png", mask)
    page = dict(
        pageId="p",
        width=160,
        height=100,
        regions=[
            dict(
                regionId="r",
                kind="bubble",
                direction="horizontal-tb",
                textBoxIds=["t1"],
                layoutArea=dict(path="mask.png"),
                backgroundColor=[255, 255, 255],
            )
        ],
    )
    args = dict(root=str(root), page=page, maximumBytes=1_000_000)
    plan = image.text_layout(args, None)
    assert plan == image.text_layout(args, None)
    assert (
        2 <= len(plan[0]["candidates"]) <= image.PARTITION_RULES["max_candidates"] + 1
    )
    page["regions"][0]["kind"] = "unframed"
    assert len(image.text_layout(args, None)[0]["candidates"]) == 1

print(
    json.dumps(
        {
            "ok": True,
            "checks": "single-pass OCR, grouping, erase fallback, composition, QA and partition",
        }
    )
)
