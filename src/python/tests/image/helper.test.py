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
        if kind == "detection":
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
assert channel.requests == ["detection"]
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
    spec = dict(
        pageId="p1",
        relativePath="page.png",
        original="originals/p1.png",
        sha256="0" * 64,
        width=120,
        height=80,
        orientation=1,
        source=source_file,
    )
    original_detect = image.ocr.image_detection_records
    original_recognize = image.recognize_text
    analyze_background = image.fill.analyze_background
    text_mask = image.repair.text_mask
    try:
        image.ocr.image_detection_records = lambda *_args, **_kwargs: [
            box(18, 18, 47, 37),
            box(48, 18, 77, 37),
        ]
        image.recognize_text = lambda _frame, points, _channel: (
            "第一" if np.asarray(points)[0, 0] < 40 else "第二"
        )
        created = image.create_page(spec, root, Channel())
        # 复杂背景找不到笔画时，准备流程应记录失败。
        image.fill.analyze_background = lambda *_: ({"route": "model"}, None)
        image.repair.text_mask = lambda *_: (_ for _ in ()).throw(
            ValueError("no strokes")
        )
        failed = image.create_page(spec, root, Channel())
    finally:
        image.ocr.image_detection_records = original_detect
        image.recognize_text = original_recognize
        image.fill.analyze_background = analyze_background
        image.repair.text_mask = text_mask
    assert created["page"]["regions"][0]["kind"] == "unframed"
    assert created["records"][0]["message"] == "第一\n第二"
    assert created["clean"]["regions"][0]["status"] == "cleaned"
    region_id = created["records"][0]["regionId"]
    assert failed["clean"]["regions"] == [{"regionId": region_id, "status": "failed"}]
    assert failed["diagnostics"]["failures"] == [
        {"regionId": region_id, "error": "no strokes"}
    ]


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
        textBoxes=[dict(textBoxId="t1", **box(20, 15, 30, 25))],
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
    )[0]
    x, y, width, height = geometry["box"]
    overlay = np.zeros((height, width, 4), np.uint8)
    overlay[height // 2, width // 2] = (255, 255, 255, 255)
    encoded = cv2.imencode(".png", overlay)[1]
    layers = root / "layers.json"
    layers.write_text(
        json.dumps(
            [
                dict(
                    eraseMask="erase-masks/p1/r1.png",
                    overlay=dict(
                        box=geometry["box"],
                        png=base64.b64encode(encoded).decode("ascii"),
                    ),
                )
            ]
        ),
        encoding="utf-8",
    )
    request = dict(
        root=str(root),
        original=original_file,
        composition=dict(clean=clean_file, layers=str(layers)),
        output=str(root / "page.png"),
    )
    composed = image.read_image(image.text_output(request, None)["path"])
    expected = clean_pixels.copy()
    expected[y + height // 2, x + width // 2] = 255
    assert np.array_equal(composed, expected)

    request.update(qa=dict(maxEdge=80, marks=[]), output=str(root / "qa.webp"))
    comparison = image.read_image(image.text_output(request, None)["path"])
    assert comparison.shape == (32, 80, 3)
    for actual, expected in zip(
        np.split(comparison, 2, axis=1), (original_pixels, composed)
    ):
        scaled = cv2.resize(expected, (40, 32), interpolation=cv2.INTER_AREA)
        assert cv2.absdiff(actual, scaled).mean() < 6

    # 没有合成层且无需缩放时也只能在右侧绘制标记。
    request.pop("composition")
    request["qa"] = dict(
        maxEdge=100,
        marks=[
            dict(regionId="r1", layoutArea="layout-areas/p1/r1.png", incomplete=True)
        ],
    )
    comparison = image.read_image(image.text_output(request, None)["path"])
    original, translated = np.split(comparison, 2, axis=1)
    assert cv2.absdiff(original, original_pixels).mean() < 6
    blue, green, red = cv2.split(translated)
    assert np.any((blue < 60) & (green > 150) & (red > 180))


with tempfile.TemporaryDirectory(prefix="lg-image-partition-") as folder:
    root = Path(folder)
    mask = np.zeros((246, 170), np.uint8)
    for center in ((70, 42), (78, 121), (70, 200)):
        cv2.circle(mask, center, 31, 255, -1)
    cv2.rectangle(mask, (68, 42), (79, 200), 255, -1)

    # 按竖排列位置直接排序会把三格文字混在一起。
    lines = [
        ("中右", box(86, 109, 94, 133)),
        ("下左", box(53, 188, 61, 212)),
        ("上左", box(53, 30, 61, 54)),
        ("中左", box(60, 109, 68, 133)),
        ("下右", box(80, 188, 88, 212)),
        ("上右", box(80, 30, 88, 54)),
        ("旁白", box(132, 75, 147, 93)),
    ]
    source = np.full((*mask.shape, 3), 255, np.uint8)
    messages = {}
    for message, line in lines:
        x, y = line["box"][0]
        messages[x, y] = message
        source[y + 1 : y + 10, x + 1 : x + 5] = 0
    original_path = image.save(root / "source.png", source)
    detect, recognize, postprocess = (
        image.detect_text,
        image.recognize_text,
        image.postprocess,
    )
    try:
        image.detect_text = lambda *_: [line for _, line in lines]
        image.recognize_text = lambda _, points, __: messages[tuple(points[0])]
        image.postprocess = lambda *_: iter([({}, mask)])
        created = image.create_page(
            dict(
                pageId="p",
                relativePath="page.png",
                original="originals/p.png",
                sha256="0" * 64,
                width=170,
                height=246,
                orientation=1,
                source=original_path,
            ),
            root,
            Channel(),
        )
    finally:
        image.detect_text, image.recognize_text, image.postprocess = (
            detect,
            recognize,
            postprocess,
        )

    page = created["page"]
    expected = [
        ("r0001-1", "上右\n上左"),
        ("r0001-2", "中右\n中左"),
        ("r0001-3", "下右\n下左"),
        ("r0002", "旁白"),
    ]
    assert [(r["regionId"], r["message"]) for r in created["records"]] == expected
    parts = [
        image.read_layout_area(root / region["layoutArea"]["path"], mask.shape)
        for region in page["regions"][:3]
    ]
    assert np.array_equal(np.bitwise_or.reduce(parts), image.fill.inset_selection(mask))
    assert all(not np.any(a & b) for i, a in enumerate(parts) for b in parts[i + 1 :])
    assert all(
        np.array_equal(
            part, image.read_layout_area(root / region["eraseMask"], mask.shape)
        )
        for part, region in zip(parts, created["clean"]["regions"])
    )

    layers = root / "layers.json"
    layers.write_text(
        json.dumps(
            [
                dict(eraseMask=created["clean"]["regions"][index]["eraseMask"])
                for index in (0, 2)
            ]
        ),
        encoding="utf-8",
    )
    output = image.text_output(
        dict(
            root=str(root),
            original=original_path,
            composition=dict(
                clean=str(root / created["clean"]["clean"]), layers=str(layers)
            ),
            output=str(root / "out.png"),
        ),
        None,
    )
    composed = image.read_image(output["path"])
    assert np.array_equal(composed[parts[1] != 0], source[parts[1] != 0])
    assert np.all(composed[(parts[0] | parts[2]) != 0] == 255)


print(
    json.dumps(
        {
            "ok": True,
            "checks": "single-pass OCR, grouping, erase fallback, composition, QA and partition",
        }
    )
)
