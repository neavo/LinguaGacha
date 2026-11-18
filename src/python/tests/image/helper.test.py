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


# 原文中心落在可写区域的空洞里时，写字框仍须完整落在区域内。
area = np.zeros((32, 32), np.uint8)
area[4:28, 4:28] = 255
area[12:20, 12:20] = 0
ink = np.zeros_like(area)
ink[14:18, 14:18] = 255
x, y, width, height = image._write_box(area, ink)
assert 0 <= x < x + width <= area.shape[1]
assert 0 <= y < y + height <= area.shape[0]
assert width >= 4 and height >= 4
assert np.all(area[y : y + height, x : x + width] != 0)


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
    # 纯色填充恢复整个内区，包括不在文字框里的浅色纹理。
    source[41, 70] = 225
    original_path = image.save(root / "normalized/p.png", source)
    detect, recognize, postprocess = (
        image.detect_text,
        image.recognize_text,
        image.postprocess,
    )
    try:
        image.detect_text = lambda *_: [line for _, line in lines]
        image.recognize_text = lambda _, points, __: messages[tuple(points[0])]
        image.postprocess = lambda *_: iter([({}, mask)])
        channel = Channel()
        scanned = image.scan(
            dict(
                pages=[
                    dict(
                        pageId="p",
                        relativePath="page.png",
                        original="originals/p.png",
                        sha256="0" * 64,
                        width=170,
                        height=246,
                        orientation=1,
                        source=original_path,
                    )
                ],
                output=str(root),
            ),
            channel,
        )
    finally:
        image.detect_text, image.recognize_text, image.postprocess = (
            detect,
            recognize,
            postprocess,
        )

    assert "inpaint" not in channel.requests
    page = scanned["pages"][0]
    expected = [
        ("r0001-1", "上右\n上左"),
        ("r0001-2", "中右\n中左"),
        ("r0001-3", "下右\n下左"),
        ("r0002", "旁白"),
    ]
    assert [(r["regionId"], r["message"]) for r in page["records"]] == expected
    [draft] = json.loads((root / "scan.json").read_text(encoding="utf-8"))
    parts = [
        image._read_candidate_area(root, "p", region, mask.shape)
        for region in draft["candidates"][:3]
    ]
    assert np.array_equal(np.bitwise_or.reduce(parts), image.fill.inset_selection(mask))
    assert all(not np.any(a & b) for i, a in enumerate(parts) for b in parts[i + 1 :])
    selected = [
        dict(pageId="p", regionId="r0001-1", message="修正原文"),
        dict(pageId="p", regionId="r0001-3", contour=True),
    ]
    prepared = image.prepare(
        dict(root=str(root), output=str(root), selected=selected), channel
    )
    regions = prepared["pages"][0]["regions"]
    assert [region["regionId"] for region in regions] == ["r0001-1", "r0001-3"]
    assert prepared["records"][0]["message"] == "修正原文"
    assert all(region["patch"] for region in regions)
    assert not (root / "patches/p/r0001-2.png").exists()
    for region, part in zip(regions, (parts[0], parts[2])):
        x, y, w, h = region["box"]
        assert np.all(part[y : y + h, x : x + w] != 0)

    overlay = np.full((1, 1, 4), (50, 120, 230, 255), np.uint8)
    encoded = base64.b64encode(cv2.imencode(".png", overlay)[1]).decode("ascii")
    write_x, write_y = regions[0]["box"][:2]
    layers = root / "layers.json"
    layers.write_text(
        json.dumps(
            [
                dict(
                    patch=regions[0]["patch"],
                    overlay=dict(box=[write_x, write_y, 1, 1], png=encoded),
                ),
                dict(patch=regions[1]["patch"]),
            ]
        ),
        encoding="utf-8",
    )
    request = dict(
        root=str(root),
        original=original_path,
        layers=str(layers),
        output=str(root / "out.png"),
    )
    composed = image.read_image(image.text_output(request, None)["path"])
    assert np.array_equal(composed[parts[1] != 0], source[parts[1] != 0])
    assert np.all(composed[parts[2] != 0] == 255)
    assert np.array_equal(composed[write_y, write_x], overlay[0, 0, :3])

    request.update(qa=dict(maxEdge=340, marks=[]), output=str(root / "qa.webp"))
    comparison = image.read_image(image.text_output(request, None)["path"])
    for actual, expected in zip(np.split(comparison, 2, axis=1), (source, composed)):
        assert cv2.absdiff(actual, expected).mean() < 6

    complete = image.prepare(
        {
            "root": str(root),
            "output": str(root / "complete"),
            "selected": [
                {"pageId": "p", "regionId": record["regionId"]}
                for record in page["records"]
            ],
        },
        channel,
    )
    whole = next(
        region for region in complete["pages"][0]["regions"] if "parts" in region
    )
    physical = complete["pages"][0]["regions"][:3]
    assert whole["parts"] == [region["regionId"] for region in physical]
    assert whole["patch"] is None
    assert len(list((root / "complete/patches/p").glob("*.png"))) == len(
        page["records"]
    )
    whole_record = next(
        record
        for record in complete["records"]
        if record["regionId"] == whole["regionId"]
    )
    assert whole_record["message"] == "上右\n上左\n中右\n中左\n下右\n下左"
    layers.write_text(
        json.dumps([{"patch": region["patch"]} for region in physical]), encoding="utf8"
    )
    body = source.copy()
    image._compose_text(body, layers, root / "complete")
    assert source[41, 70, 0] == 225 and body[41, 70, 0] == 255
    assert np.array_equal(body[mask == 0], source[mask == 0])
    analyze_background = image.fill.analyze_background
    inpaint, text_mask = image.repair.inpaint, image.repair.text_mask
    try:
        image.fill.analyze_background = lambda *_: ({"route": "model"}, [255, 255, 255])

        def skip_top(frame, selection, boxes, **options):
            if boxes[0][0][1] < 60:
                raise ValueError("Empty repair mask")
            return text_mask(frame, selection, boxes, **options)

        def unchanged(frame, write_mask, forward):
            forward(np.zeros((1, 4, 64, 64), np.float32))
            return frame[write_mask > 0]

        image.repair.inpaint = unchanged
        image.repair.text_mask = skip_top
        selected[1].pop("contour")
        degraded = image.prepare(
            dict(root=str(root), output=str(root / "failed"), selected=selected),
            channel,
        )
        assert channel.requests.count("inpaint") == 1
        assert [region["patch"] for region in degraded["pages"][0]["regions"]] == [
            None,
            None,
        ]
        assert not (root / "failed/patches").exists()
        assert degraded["records"] == prepared["records"]
    finally:
        image.fill.analyze_background = analyze_background
        image.repair.inpaint, image.repair.text_mask = inpaint, text_mask

    inspected = image.inspect_bubble_group(
        {
            "root": str(root),
            "output": str(root / "review.png"),
            "pageId": "p",
            "group": "r0001",
        },
        None,
    )
    ids = {line["message"]: line["textBoxId"] for line in inspected["lines"]}
    assert len(ids) == 6
    assert image.read_image(inspected["preview"]).shape == source.shape
    target = {"pageId": "p", "group": "r0001"}
    correction = {
        **target,
        "parts": [
            {
                "textBoxIds": [ids["上右"], ids["上左"], ids["中右"], ids["中左"]],
                "translate": True,
            },
            {"textBoxIds": [ids["下右"], ids["下左"]], "translate": False},
        ],
    }
    request = {
        "root": str(root),
        "output": str(root / "corrected"),
        "selected": [],
        "partitions": [correction],
        "repartition": target,
        "reserved": [],
    }
    corrected = image.prepare(request, channel)
    [record] = corrected["records"]
    assert record["regionId"].startswith("r0001-qa-")
    assert set(record["message"].splitlines()) == {"上右", "上左", "中右", "中左"}
    assert len(corrected["pages"][0]["regions"]) == 1
    composed = source.copy()
    patched = root / "correction-layers.json"
    patch = corrected["pages"][0]["regions"][0]["patch"]
    patched.write_text(json.dumps([{"patch": patch}]), encoding="utf-8")
    image._compose_text(composed, patched, root / "corrected")
    assert np.array_equal(composed[parts[2] != 0], source[parts[2] != 0])
    # 新分格可以继续通过普通的局部消字入口处理。
    request.pop("repartition")
    request["selected"] = [
        {"pageId": "p", "regionId": record["regionId"], "contour": True}
    ]
    replayed = image.prepare(request, channel)
    assert replayed["records"] == corrected["records"]

    correction["parts"][1]["textBoxIds"][0] = ids["上右"]
    try:
        image.prepare(request, channel)
    except ValueError as error:
        assert "exactly one part" in str(error)
    else:
        raise AssertionError("Accepted duplicate OCR box assignment")

print(
    json.dumps(
        {"ok": True, "checks": "OCR, selection, partition, contour, composition and QA"}
    )
)
