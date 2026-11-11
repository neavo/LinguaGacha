"""验证媒体图片读写、文字区间与语音分窗。参数是源码或部署的 runtime 目录。"""

import importlib.util
import io
import sys
import tempfile
from concurrent.futures import Future
from contextlib import chdir
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import numpy as np

runtime = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("media", runtime / "media.py")
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)

media.initialize("scan")  # 本文件同时检查检测与语音，两组依赖都加载。
media.initialize("speech")

# 中文必须出现在传入的路径中，仅工作目录含中文不足以复现路径问题。
check = TestCase()
with tempfile.TemporaryDirectory(prefix="media images ") as directory, chdir(directory):
    colour = (20, 80, 220)
    frame = np.full((24, 48, 3), colour, dtype=np.uint8)
    for root in (Path.cwd() / "中文绝对路径", Path("中文相对路径")):
        root.mkdir()
        file = root / "字幕裁图.jpg"
        media.crop(frame, [0, 0, 48, 24], file)
        crop = media.cv2.imdecode(np.fromfile(file, dtype=np.uint8), media.cv2.IMREAD_COLOR)
        assert crop is not None and crop.shape == frame.shape
        entries = [{"id": 7, "start": 12, "file": str(file)}]
        sheets = media.sheet(None, entries, root / "字幕图集")
        assert len(sheets) == 1 and sheets[0]["ids"] == [7], sheets
        image = media.cv2.imdecode(np.fromfile(sheets[0]["file"], dtype=np.uint8), media.cv2.IMREAD_COLOR)
        assert image is not None and image.shape[0] > frame.shape[0]
        assert np.allclose(image[-frame.shape[0]:, :frame.shape[1]].mean(axis=(0, 1)), colour, atol=5)

    for name, content, error in (
        ("缺失.jpg", None, FileNotFoundError),
        ("空文件.jpg", b"", ValueError),
        ("损坏.jpg", b"not an image", ValueError),
    ):
        file = Path(name)
        if content is not None:
            file.write_bytes(content)
        with check.assertRaises(error) as raised:
            media.sheet(None, [{"id": 7, "start": 12, "file": str(file)}], "失败图集")
        assert str(file) in str(raised.exception)

    # 用已有目录触发真实写入失败，避免依赖不同平台的只读权限语义。
    with check.assertRaises(OSError):
        media.crop(frame, [0, 0, 48, 24], Path(directory))


# 真实检测与 OCR 前处理链保留高竖排候选，空识别也保留文字块。
class TextInference:
    """提供空 OCR 应答，并检查真实前处理是否满足模型输入契约。"""

    def request(self, kind, features):
        """检查 OCR 输入，检测请求由各场景提供输出。"""
        future = Future()
        if kind == "rec":
            assert features.shape[:3] == (1, 3, 48)
            assert np.isfinite(features).all() and features.min() >= -1 and features.max() <= 1
        future.set_result(({"tokens": []}, b""))
        return future


pred = np.zeros((100, 100), np.float32)
pred[10:90, 40:55] = 0.99
frame = np.zeros((100, 100, 3), np.uint8)
boxes = [
    media.read_block(TextInference(), frame, box)
    for box in media.detect_blocks({"shape": [100, 100], "dtype": "float32"}, pred.tobytes(), frame)
]
assert any(box.rect[3] - box.rect[1] > 50 and box.lines == ((),) for box in boxes), boxes

# 长行扩宽，成员行分组保留阅读顺序。
wide = media.rec_input(np.full((20, 1000, 3), 255, np.uint8), np.float32([[0, 0], [999, 0], [999, 19], [0, 19]]))
assert wide.shape[3] > media.REC_MIN_WIDTH and wide.shape[2] == media.REC_HEIGHT
points = [np.float32([[0, y], [40, y], [40, y + 10], [0, y + 10]]) for y in [0, 12]]
group = media.group_lines(points)[0]
assert [line[0, 1] for line in group.members] == [0, 12]


def block(tokens=(1, 2, 3, 4), rect=(0, 0, 40, 10)):
    """独立指定内容与位置，构造单行文字块。"""
    return media.TextBlock(rect, (tokens,))


def track(sequence):
    """从连续帧观察最终区间，不读取跟踪器的内部匹配状态。"""
    tracker = media.TextTracker()
    for second, found in enumerate(sequence):
        tracker.update(second, found)
    return [(r["start"], r["end"]) for r in tracker.regions]


# 相邻帧各自接近首帧时，仍须比较它们之间的内容变化。
assert track([[block()], [block((1, 2, 3, 5))], [block()]]) == [(0, 3)]
assert track([[block()], [block((5, 2, 3, 4))], [block((1, 6, 3, 4))]]) == [(0, 2), (2, 3)]
assert track([[block()], [block((7, 8, 9, 10))]]) == [(0, 1), (1, 2)]
assert track([[block()], [], [block()]]) == [(0, 1), (2, 3)]
assert track([[block(())], [block(())], [block()]]) == [(0, 1), (1, 2), (2, 3)]
# 多候选不能贪心抢占。单行变化不能被长的另一行稀释。
assert track([[block(), block(rect=(2, 0, 42, 10))], [block()]]) == [(0, 1), (0, 1), (1, 2)]
assert track([[block()], [block(), block(rect=(2, 0, 42, 10))]]) == [(0, 1), (1, 2), (1, 2)]
long_line = tuple(range(30))
assert not media.same_content((long_line, (1,)), (long_line, (2,)))
assert not media.same_content(((1, 2),), ((1,), (2,)))

# 较大裁图替换代表帧后，固定参照仍须阻止连续小变化累积成换句。
with tempfile.TemporaryDirectory(prefix="media text ") as directory:
    frame = np.zeros((30, 60, 3), np.uint8)
    found = [[block()], [block((1, 2, 3, 5), rect=(0, 0, 45, 12))], [block((1, 2, 6, 5))]]
    with (
        patch.object(media, "decode", return_value=iter([frame] * 3)),
        patch.object(media, "detect_blocks", side_effect=found),
        patch.object(media, "read_block", side_effect=lambda channel, frame, block: block),
    ):
        regions = media.scan(TextInference(), "unused", "unused", 60, 30, directory)
    assert [(r["start"], r["end"], r["at"]) for r in regions] == [(0, 2, 1), (2, 3, 2)]
    assert {p.name for p in Path(directory).glob("*.jpg")} == {"0.jpg", "1.jpg"}

# 边界取相邻样本中点。未知、闪烁或窗口未包住边界时交还调用者。
assert media.text_boundary([False, True, True, True], 5, 6, 20, True) == 5.125
assert media.text_boundary([True, True, False, False], 5, 6, 20, False) == 5.375
assert media.text_boundary([True] * 4, 0, 1, 1, True) == 0
assert media.text_boundary([True] * 4, 0, 1, 1, False) == 1
for states in ([False] * 4, [False, True, False, True], [False, None, True, True]):
    assert media.text_boundary(states, 5, 6, 20, True) is None
assert media.text_boundary([True] * 4, 5, 6, 20, True) is None
assert media.text_boundary([True] * 4, 5, 6, 20, False) is None
assert media.text_boundary([True], 5, 6, 6, False) is None


def timed_decode(ffmpeg, source, size, fps, start=None, duration=None):
    """把采样时间编码到像素，验证校准入口的时间换算。"""
    return (np.full((size[1], size[0], 3), start + i / fps) for i in range(round(duration * fps)))


def timed_text(channel, frame, found):
    """在同一位置切换内容，其他区域不应触发 OCR。"""
    assert found.rect == (0, 0, 40, 10)
    at = frame[0, 0, 0]
    return block((1, 2, 3, 4) if 10 <= at < 13 else (7, 8, 9, 10) if 13 <= at < 16 else (11, 12, 13, 14))


row = {"row": 7, "start": 10, "end": 13, "box": [0, 0, 40 / 64, 10 / 64]}
detected = [media.DetectedBlock((0, 0, 40, 10), ()), media.DetectedBlock((40, 40, 60, 60), ())]
with (
    patch.object(media, "decode", side_effect=timed_decode) as decoded,
    patch.object(media, "detect_blocks", return_value=detected) as detected_frames,
    patch.object(media, "read_block", side_effect=timed_text) as recognized,
):
    rows = [dict(row, row=8), row, dict(row, row=9, start=13, end=16)]
    result = media.refine(TextInference(), "unused", "unused", 64, 64, 20, rows)
    assert result == [
        {"row": 8, "start": 9.875, "end": 12.875},
        {"row": 7, "start": 9.875, "end": 12.875},
        {"row": 9, "start": 12.875, "end": 15.875},
    ], result
    times = [call.args[2][0, 0, 0] for call in detected_frames.call_args_list]
    assert len(times) == len(set(times)) == recognized.call_count
    assert decoded.call_count == 1  # 相邻条目的窗口和中点通过短空档共用一次解码。

# 候选有歧义时跳过 OCR，空识别交还未决。空批次不启动解码。
with patch.object(media, "decode", side_effect=timed_decode) as decoded:
    assert media.refine(TextInference(), "unused", "unused", 64, 64, 20, []) == []
    decoded.assert_not_called()
    with (
        patch.object(media, "detect_blocks", return_value=[detected[0]] * 2),
        patch.object(media, "read_block") as recognized,
    ):
        assert media.refine(TextInference(), "unused", "unused", 64, 64, 20, [row]) == [
            {"row": 7, "start": None, "end": None}
        ]
        recognized.assert_not_called()
    with (
        patch.object(media, "detect_blocks", return_value=detected),
        patch.object(media, "read_block", return_value=block(())),
    ):
        assert media.refine(TextInference(), "unused", "unused", 64, 64, 20, [row]) == [
            {"row": 7, "start": None, "end": None}
        ]

# 非整格边界仍在原窗口内，极短条目保留中点取帧，稀疏条目不解码中间长空档。
with (
    patch.object(media, "decode", side_effect=timed_decode) as decoded,
    patch.object(media, "detect_blocks", return_value=detected),
    patch.object(media, "read_block", side_effect=timed_text),
):
    shifted = media.refine(TextInference(), "unused", "unused", 64, 64, 20, [dict(row, start=10.1, end=12.9)])
    assert shifted == [{"row": 7, "start": 9.875, "end": 12.875}]
    media.refine(
        TextInference(),
        "unused",
        "unused",
        64,
        64,
        1000,
        [dict(row, start=0.06, end=0.19), dict(row, start=900, end=903)],
    )
    assert any(call.args[4] == 0.125 for call in decoded.call_args_list)
    assert all(call.args[5] < 10 for call in decoded.call_args_list)
    clipped = media.refine(TextInference(), "unused", "unused", 64, 64, 2, [dict(row, start=0, end=2)])
    assert clipped == [{"row": 7, "start": 0, "end": 2}]


def incomplete_decode(*args):
    """模拟正常退出但未提供全部采样的解码器。"""
    yield next(timed_decode(*args))


with (
    patch.object(media, "decode", incomplete_decode),
    patch.object(media, "detect_blocks", return_value=detected),
    patch.object(media, "read_block", side_effect=timed_text),
):
    assert media.refine(TextInference(), "unused", "unused", 64, 64, 20, [row]) == [
        {"row": 7, "start": None, "end": None}
    ]


class FailedInference:
    """让在途检测失败，验证解码生成器仍被关闭。"""

    def request(self, kind, features):
        """通过 Future 复现异步推理失败。"""
        future = Future()
        future.set_exception(RuntimeError("stopped"))
        return future


closed = []


def closing_decode(*args):
    """记录解码资源的收尾。"""
    try:
        yield from timed_decode(*args)
    finally:
        closed.append(True)


with patch.object(media, "decode", closing_decode), check.assertRaisesRegex(RuntimeError, "stopped"):
    media.refine(FailedInference(), "unused", "unused", 64, 64, 20, [row])
assert closed

# 调用真实 speech/ASR 前端，证明 20.01 秒区间仍按整数采样均分成两个窗口。
with tempfile.TemporaryDirectory(prefix="media windows ") as directory:
    files = []
    for dimensions in [400, 560]:
        file = Path(directory) / f"{dimensions}.mvn"
        file.write_text(
            "<AddShift>\n<LearnRateCoef> 1 [ "
            + "0 " * dimensions
            + "]\n<Rescale>\n<LearnRateCoef> 1 [ "
            + "1 " * dimensions
            + "]\n"
        )
        files.append(str(file))

    class Decoder:
        stdout = io.BytesIO(np.full(320400, 1000, "<i2").tobytes())

        def wait(self):
            return 0

    class Inference:
        def request(self, kind, features, **fields):
            future = Future()
            if kind == "vad":
                scores = np.full((1, features.shape[1], 248), 0.01, np.float32)
                future.set_result(({"shape": list(scores.shape), "dtype": "float32"}, scores.tobytes()))
            else:
                assert features.shape[2] == 560
                future.set_result(({"tokens": ["fixture"], "timestamps": [0]}, b""))
            return future

    with patch.object(media, "ffmpeg_process", return_value=Decoder()):
        result = media.speech(Inference(), "unused", "unused", 0, False, "auto", files[1], files[0])
    assert result["spans"] == [[0, 320160]], result
    assert [[window["from"], window["end"]] for window in result["windows"]] == [[0, 160080], [160080, 320160]]
    assert all(window["tokens"] == ["fixture"] for window in result["windows"])
print("media boundaries passed")
