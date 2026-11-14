"""图片第一阶段像素边界测试：normalize / prepare / build_mask / check_background / erase / pack。"""

import importlib.util
import json
import sys
import tempfile
import zipfile
from concurrent.futures import Future
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("image_runtime", Path(sys.argv[1]) / "image.py")
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)


def quad(x0, y0, x1, y1):
    return [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}]


# 1. YOLO 后处理多类别与空置信度过滤
raw = np.zeros((1, 39, 3), np.float32)
raw[0, :4] = np.array([[16, 16, 10, 10]] * 3).T
raw[0, 4, :2], raw[0, 5, 2], raw[0, 7, :] = [0.9, 0.8], 0.7, 1
proto = np.ones((1, 32, 8, 8), np.float32)
boxes, _ = image.postprocess(raw, proto, (32, 32), (32, 32))
assert len(boxes) == 2 and set(boxes[:, 5]) == {0, 1}
raw[0, 4:7] = 0
assert len(image.postprocess(raw, proto, (32, 32), (32, 32))[0]) == 0


class MockChannel:
    """按请求类型返回固定模拟张量：先全图 det、再局部补检 det、外加 YOLO manga 与 LaMa。"""

    def __init__(self, orig_shape):
        self.h, self.w = orig_shape
        self.det_calls = []

    def request(self, kind, array):
        f = Future()
        if kind == "manga":
            # 构造两嵌套气泡 (outer 40..300, inner 80..240) 与一高重合重复泡。
            _, _, ih, iw = array.shape
            gain = min(ih / self.h, iw / self.w)
            pad_x = round((iw - round(self.w * gain)) / 2 - 0.1)
            pad_y = round((ih - round(self.h * gain)) / 2 - 0.1)
            raw_out = np.zeros((1, 39, 3), np.float32)
            # cx, cy, bw, bh in padded input
            specs = [
                (170, 170, 200, 200, 0.90),  # outer bubble
                (170, 170, 198, 198, 0.75),  # dup outer bubble (IoU > 0.5)
                (165, 165, 120, 120, 0.85),  # inner bubble
            ]
            for idx, (cx, cy, bw, bh, sc) in enumerate(specs):
                raw_out[0, 0, idx] = cx * gain + pad_x
                raw_out[0, 1, idx] = cy * gain + pad_y
                raw_out[0, 2, idx] = bw * gain
                raw_out[0, 3, idx] = bh * gain
                raw_out[0, 6, idx] = sc  # label 2 = bubble
            raw_out[0, 7, :] = 1.0
            proto_out = np.ones((1, 32, ih // 4, iw // 4), np.float32)
            payload = np.concatenate([raw_out.ravel(), proto_out.ravel()]).astype(np.float32).tobytes()
            f.set_result((dict(shapes=[list(raw_out.shape), list(proto_out.shape)]), payload))
            return f

        if kind == "det":
            _, _, th, tw = array.shape
            self.det_calls.append((tw, th))
            prob = np.zeros((th, tw), np.float32)
            if len(self.det_calls) == 1:
                # 全图 det 只放一个自由文本行在右侧，故意不给左侧气泡内留文字，迫使触发局部补检。
                prob[int(th * 0.2) : int(th * 0.35), int(tw * 0.7) : int(tw * 0.9)] = 0.95
            else:
                # 局部放大补检 det 返回最内层气泡中心一条清晰文字行。
                prob[int(th * 0.35) : int(th * 0.65), int(tw * 0.25) : int(tw * 0.75)] = 0.95
            f.set_result((dict(dtype="float32", shape=[th, tw]), prob.astype(np.float32).tobytes()))
            return f

        if kind == "inpaint":
            rgb = array[0, :3].copy()
            rgb[:] = 0.5
            payload = rgb[None].astype(np.float32).tobytes()
            f.set_result((dict(shapes=[[1, 3, array.shape[2], array.shape[3]]]), payload))
            return f

        raise ValueError(f"Unknown kind: {kind}")


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)

    # 2. normalize 无模型规范化
    sample_img = np.full((600, 600, 3), 255, np.uint8)
    raw_src = image.save(root / "raw.png", sample_img)
    norm_res = image.normalize(
        dict(pages=[dict(pageId="p1", source=raw_src, target=str(root / "norm.png"))]), None
    )
    assert norm_res["pages"][0]["width"] == 600 and Path(norm_res["pages"][0]["path"]).exists()

    # 3. prepare：局部补检、重复泡合并、嵌套归属最内层及自由文本组
    ch = MockChannel(sample_img.shape[:2])
    prep = image.prepare(dict(source=raw_src, output=str(root / "prep")), ch)
    assert len(ch.det_calls) >= 2, "应为缺失 PP 文字行的气泡触发局部放大补检"
    assert ch.det_calls[1] == (320, 320)
    assert image.det_input(np.zeros((400, 400, 3), np.uint8), side=320, upscale=True).shape[2:] == (384, 384)
    assert Path(prep["preview"]).exists() and Path(root / "prep" / "evidence.json").exists()
    # 最内层气泡拥有内部行，外层只剩空线且不重复抢占，右半侧自由文本自成一组。
    sources = {c["source"] for c in prep["candidates"]}
    assert "bubble+det" in sources and "det_group" in sources

    # 4. build_mask / check_background / erase 三类底色与梯度检测
    for name, bg, fg in [("edge", [255, 255, 255], [0, 0, 0]), ("paper", [140, 190, 215], [10, 10, 10]), ("dark", [20, 20, 20], [240, 240, 240])]:
        orig = np.full((120, 240, 3), bg, np.uint8)
        cv2.putText(orig, "ABC", (20, 70), 0, 0.9, fg, 2)
        if name == "edge":
            cv2.line(orig, (0, 0), (0, 119), (0, 0, 0), 3)
        region = dict(
            regionId="a",
            kind="bubble",
            disposition="translate",
            textAreas=[quad(12, 35, 95, 85)],
            direction="horizontal-tb",
            erase=dict(method="auto", mask="strokes", exclusions=[]),
        )
        mask, gap = image.build_mask(orig, region)
        assert mask.any() and gap is None
        uniform, color = image.check_background(orig, mask)
        assert uniform and np.array_equal(color, bg)
        src_path = image.save(root / f"{name}.png", orig)
        erased = image.erase(
            dict(source=src_path, output=str(root / f"erase-{name}"), page=dict(width=240, height=120, regions=[region])),
            None,
        )
        assert erased["ok"] and erased["regions"][0]["method"] == "fill"
        clean_img = image.read_image(erased["clean"])
        assert np.all(clean_img[mask > 0] == bg)
        assert np.array_equal(clean_img[mask == 0], orig[mask == 0])

    # 渐变背景不得走 flat-fill，必须走 lama；未声明重叠须返回 mask_overlap 并不产出 clean。
    grad = np.tile(np.linspace(0, 255, 240, dtype=np.uint8), (120, 1))[:, :, None]
    grad = np.repeat(grad, 3, axis=2)
    cv2.putText(grad, "X", (60, 70), 0, 1.0, (0, 0, 255), 2)
    grad_src = image.save(root / "grad.png", grad)
    r1 = dict(regionId="r1", kind="text", disposition="translate", textAreas=[quad(45, 35, 100, 85)], direction="horizontal-tb", erase=dict(method="auto", mask="areas", padding=0, exclusions=[]))
    r2 = dict(regionId="r2", kind="text", disposition="translate", textAreas=[quad(70, 35, 130, 85)], direction="horizontal-tb", erase=dict(method="auto", mask="areas", padding=0, exclusions=[]))
    conflict_res = image.erase(
        dict(source=grad_src, output=str(root / "erase-conflict"), page=dict(width=240, height=120, regions=[r1, r2])),
        MockChannel((120, 240)),
    )
    assert not conflict_res["ok"] and conflict_res["clean"] is None
    assert any(g["code"] == "mask_overlap" for g in conflict_res["gaps"])

    # 显式通过 exclusions 扣除交叠后，允许在渐变底上走 LaMa 顺利完成并验证掩码外无损。
    r2["erase"]["exclusions"] = [quad(45, 35, 100, 85)]
    fixed_res = image.erase(
        dict(source=grad_src, output=str(root / "erase-fixed"), page=dict(width=240, height=120, regions=[r1, r2])),
        MockChannel((120, 240)),
    )
    assert fixed_res["ok"] and all(r["method"] == "lama" for r in fixed_res["regions"])

    # 5. pack 核验原文/底图/掩码摘要及掩码外像素逐像素一致
    pack_root = root / "pack"
    (pack_root / "originals").mkdir(parents=True)
    (pack_root / "clean").mkdir(parents=True)
    (pack_root / "masks" / "p1").mkdir(parents=True)
    orig_copy = Path(pack_root / "originals" / "p1.png")
    orig_copy.write_bytes(Path(grad_src).read_bytes())
    clean_copy = Path(pack_root / "clean" / "p1.png")
    clean_copy.write_bytes(Path(fixed_res["clean"]).read_bytes())
    mask1_copy = Path(pack_root / "masks" / "p1" / "r1.png")
    mask1_copy.write_bytes(Path(fixed_res["regions"][0]["mask"]).read_bytes())
    mask2_copy = Path(pack_root / "masks" / "p1" / "r2.png")
    mask2_copy.write_bytes(Path(fixed_res["regions"][1]["mask"]).read_bytes())

    book = dict(
        version=1,
        bookId="b1",
        pages=[
            dict(
                pageId="p1",
                original="originals/p1.png",
                sha256=image.file_sha256(orig_copy),
                width=240,
                height=120,
                orientation=1,
                regions=[r1, r2],
            )
        ],
    )
    clean_doc = dict(
        version=1,
        bookId="b1",
        status="complete",
        pages=[
            dict(
                pageId="p1",
                clean="clean/p1.png",
                cleanSha256=image.file_sha256(clean_copy),
                inputSha256="0" * 64,
                regions=[
                    dict(regionId="r1", disposition="translate", method="lama", mask="masks/p1/r1.png", maskSha256=image.file_sha256(mask1_copy)),
                    dict(regionId="r2", disposition="translate", method="lama", mask="masks/p1/r2.png", maskSha256=image.file_sha256(mask2_copy)),
                ],
            )
        ],
    )
    out_zip = str(root / "out.image")
    image.pack(dict(root=str(pack_root), book=book, records=[], clean=clean_doc, output=out_zip), None)
    with zipfile.ZipFile(out_zip) as zf:
        assert {"image.json", "items.json", "clean.json", "originals/p1.png", "clean/p1.png", "masks/p1/r1.png", "masks/p1/r2.png"}.issubset(zf.namelist())

    # 篡改掩码外像素应被 pack 在线拒绝。
    tampered = image.read_image(clean_copy)
    tampered[0, 0] = [0, 255, 0]
    image.save(clean_copy, tampered)
    clean_doc["pages"][0]["cleanSha256"] = image.file_sha256(clean_copy)
    try:
        image.pack(dict(root=str(pack_root), book=book, records=[], clean=clean_doc, output=str(root / "bad.image")), None)
        raise AssertionError("Expected pixel conservation failure")
    except ValueError as err:
        assert "outside masks" in str(err)

# 6. YOLO 独有补漏候选保留（含 0.40158）与基于文字行形状的方向建议（不再按容器宽高比猜测）
yolo_only = image._group_candidates(
    [dict(pts=image.rect_to_pts(10, 10, 50, 90), area=3200.0, score=0.31)],
    [dict(pts=image.rect_to_pts(100, 10, 180, 40), area=2400.0, score=0.40158)],
    [],
)
assert len(yolo_only) == 2 and all(c["source"] == "yolo_only" and c["uncertain"] for c in yolo_only)
assert image._suggest_direction(yolo_only[0]) is None
assert (
    image._suggest_direction(
        dict(
            source="bubble+det",
            textAreas=[image.rect_to_pts(10, 10, 90, 28), image.rect_to_pts(10, 34, 90, 52)],
        )
    )
    == "horizontal-tb"
)
assert image._suggest_direction(dict(source="bubble+det", textAreas=[image.rect_to_pts(10, 10, 42, 40)])) is None
assert (
    image._suggest_direction(
        dict(
            source="bubble+det",
            textAreas=[image.rect_to_pts(10, 10, 28, 90), image.rect_to_pts(10, 100, 90, 118)],
        )
    )
    is None
)

# 7. 气泡去重必须在文字行匹配后进行：不同文字行的大重合气泡保留，相同非空成员气泡合并并记录合并关系。
diff_lines = image._group_candidates(
    [
        dict(pts=image.rect_to_pts(10, 10, 110, 110), area=10000.0, score=0.92),
        dict(pts=image.rect_to_pts(10, 35, 110, 135), area=10000.0, score=0.81),
    ],
    [],
    [image.rect_to_pts(20, 14, 90, 32), image.rect_to_pts(20, 114, 90, 132)],
)
assert len(diff_lines) == 2 and all(c["source"] == "bubble+det" for c in diff_lines)

same_lines = image._group_candidates(
    [
        dict(pts=image.rect_to_pts(10, 10, 110, 110), area=10000.0, score=0.92),
        dict(pts=image.rect_to_pts(12, 12, 108, 108), area=9216.0, score=0.78),
    ],
    [],
    [image.rect_to_pts(25, 25, 95, 50)],
)
assert len(same_lines) == 1 and abs(same_lines[0]["score"] - 0.92) < 1e-6 and len(same_lines[0].get("merged", [])) == 1

print("image boundaries passed")
