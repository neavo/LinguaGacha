"""视频技能负责确定性处理。网络和凭据归工作区宿主，质量判断归 Agent。"""

import argparse
import json
import math
import re
import subprocess
import tempfile
import zipfile
from itertools import pairwise
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from json_repair import repair_json

MAX_SECONDS = 210
HOP_SECONDS = 0.1
SAMPLE_RATE = 16000
SILENCE_DB = -40
MIN_PAUSE = 3  # 100ms 格数
UNCOVERED_SECONDS = 5
PACKAGE_MAX_BYTES = 900 * 1024 * 1024
CUSTOM_RENDERER = "render.mjs"


def save(file, value):
    """原子替换 JSON，续跑只读取完整结果。"""
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix(file.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(file)


def load(file):
    """读取技能工作材料。"""
    return json.loads(Path(file).read_text(encoding="utf-8"))


def ffmpeg(args, *, check=True, **kwargs):
    """通过 uv 安装的包定位 ffmpeg，并保留进程退出结果。"""
    return subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", *args], check=check, **kwargs
    )


def inspect(source):
    """提取媒体时间轴和可选流，封面图不参与视频选择。"""
    result = ffmpeg(
        ["-i", str(source)], capture_output=True, check=False
    )  # 无输出目标时 ffmpeg 返回非零。
    text = result.stderr.decode("utf-8", errors="replace")
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not duration:
        raise ValueError("无法读取媒体时长：" + text)
    streams = [line.strip() for line in text.splitlines() if re.search(r"Stream #\d+:\d+", line)]
    videos = [line for line in streams if "Video:" in line and "attached pic" not in line]
    size = re.search(r"\b(\d{2,})x(\d{2,})\b", videos[0]) if videos else None
    if videos and not size:
        raise ValueError("无法读取原视频尺寸")
    return {
        "duration": sum(
            float(part) * scale for part, scale in zip(duration.groups(), (3600, 60, 1))
        ),
        "video": {"width": int(size[1]), "height": int(size[2])} if size else None,
        "audio": [line for line in streams if "Audio:" in line],
        "subtitles": [line for line in streams if "Subtitle:" in line],
        "streams": streams,
    }


def energy(source, track):
    """按 100ms 计算音轨能量，供切段与声音覆盖统计复用。"""
    # PCM 写临时文件并映射，长素材不把整段解码音频复制进内存。
    with tempfile.TemporaryDirectory() as directory:
        pcm = Path(directory) / "audio.pcm"
        ffmpeg(
            [
                "-v",
                "error",
                "-i",
                str(source),
                "-map",
                f"0:a:{track}",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "s16le",
                str(pcm),
            ],
        )
        if pcm.stat().st_size == 0:
            return np.array([], dtype=np.float32)
        data = np.memmap(pcm, dtype=np.int16, mode="r")
        hop = int(SAMPLE_RATE * HOP_SECONDS)
        values = []
        block = hop * 600
        for start in range(0, len(data), block):
            samples = np.asarray(data[start : start + block], dtype=np.float32) / 32768
            samples = np.pad(samples, (0, (-len(samples)) % hop))
            rms = np.sqrt(np.mean(samples.reshape(-1, hop) ** 2, axis=1))
            values.extend(20 * np.log10(np.maximum(rms, 1e-6)))
        del data  # Windows 删除临时文件前释放映射。
    return np.asarray(values)


def cuts(duration, db):
    """按停顿优先级选择切点，所有分段都遵守时长上限。"""
    result = [0.0]
    while duration - result[-1] > MAX_SECONDS:
        start = round(result[-1] / HOP_SECONDS)
        cut = None
        if db is not None:
            for lower, upper in ((180, 210), (120, 180)):
                best, run = (0, 0), 0
                for i in range(start + lower * 10, min(start + upper * 10, len(db))):
                    run = run + 1 if db[i] < SILENCE_DB else 0
                    if run > best[0]:
                        best = (run, i - run + 1 + run // 2)
                if best[0] >= MIN_PAUSE:
                    cut = best[1] * HOP_SECONDS
                    break
            if cut is None:
                lo, hi = start + 1200, min(start + 2100, len(db))
                if hi > lo:
                    cut = (lo + int(np.argmin(db[lo:hi]))) * HOP_SECONDS
        result.append(round(cut if cut is not None else result[-1] + MAX_SECONDS, 2))
    return result + [duration]


def prepare(source, directory, track):
    """把素材切段转码为包目录，已发布的分段可以续用。"""
    source, root = Path(source).resolve(), Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    info = inspect(source)
    if info["audio"] and not 0 <= track < len(info["audio"]):
        raise ValueError("音轨不存在")
    if info["video"] is None and not info["audio"]:
        raise ValueError("素材没有音视频流")
    # 路径相同也可能替换过素材，续跑同时核对文件事实和音轨。
    identity = {
        "path": str(source),
        "size": source.stat().st_size,
        "mtime_ns": source.stat().st_mtime_ns,
        "track": track,
    }
    identity_file = root / "source.json"  # 只用于续跑，不进入包。
    if identity_file.exists() and load(identity_file) != identity:
        raise ValueError("来源或音轨已变化，请使用新的工作目录")
    save(identity_file, identity)
    manifest_file = root / "video.json"
    if not manifest_file.exists():
        db = energy(source, track) if info["audio"] else None
        save(
            manifest_file,
            {
                "video": info["video"],
                "segments": [
                    {"path": f"segments/{i:03}.mp4", "start": start, "end": end}
                    for i, (start, end) in enumerate(pairwise(cuts(info["duration"], db)))
                ],
            },
        )
    if not (root / "items.json").exists():
        save(root / "items.json", [])
    manifest = load(manifest_file)
    for i, segment in enumerate(manifest["segments"]):
        target = root / segment["path"]
        if target.exists():
            continue
        target.parent.mkdir(exist_ok=True)
        temporary = target.with_suffix(".tmp.mp4")
        args = ["-v", "error", "-y", "-ss", str(segment["start"]), "-i", str(source)]
        if manifest["video"] is None:
            args += ["-f", "lavfi", "-i", "color=c=black:s=256x144:r=1", "-map", "1:v:0"]
        else:
            args += [
                "-map",
                "0:V:0",
                "-vf",
                "fps=1,scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            ]
        if info["audio"]:
            args += ["-map", f"0:a:{track}", "-c:a", "aac", "-b:a", "48k", "-ac", "1"]
        if manifest["video"] is None:
            args += ["-shortest"]
        args += [
            "-t",
            str(segment["end"] - segment["start"]),
            "-c:v",
            "libx264",
            "-crf",
            "30",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(temporary),
        ]
        ffmpeg(args)
        temporary.replace(target)
        print(f"转码 {i + 1}/{len(manifest['segments'])}", flush=True)


def visible_text(response):
    """忽略推理内容，只连接 Responses 的可见文本。"""
    return "\n".join(
        part.get("text", "")
        for entry in response.get("output", [])
        for part in entry.get("content", [])
        if part.get("type") == "output_text"
    )


def number(value):
    """时间必须是有限实数，布尔值不能作为秒数。"""
    return type(value) in (int, float) and math.isfinite(value)


def uncovered_voice(file, segment, rows):
    """列出有声音但没有对话覆盖的整片时间段。音乐和音效同样计入。"""
    if not inspect(file)["audio"]:
        return []
    voiced = energy(file, 0) >= SILENCE_DB
    for row in rows:
        if row.get("kind") == "dialogue" and number(row.get("start")) and number(row.get("end")):
            first = max(0, int((row["start"] - segment["start"]) / HOP_SECONDS))
            voiced[first : max(first, math.ceil((row["end"] - segment["start"]) / HOP_SECONDS))] = (
                False
            )
    spans, begin = [], None
    for i, value in enumerate([*voiced, False]):
        if value and begin is None:
            begin = i
        elif not value and begin is not None:
            if (i - begin) * HOP_SECONDS >= UNCOVERED_SECONDS:
                spans.append(
                    [
                        round(segment["start"] + begin * HOP_SECONDS, 1),
                        round(segment["start"] + i * HOP_SECONDS, 1),
                    ]
                )
            begin = None
    return spans


def parse(directory):
    """把响应转为整片时间的行并输出事实摘要，已有的行保留 Agent 的修正。"""
    root = Path(directory)
    summary = []
    for i, segment in enumerate(load(root / "video.json")["segments"]):
        response_file, rows_file = root / f"{i:03}.response.json", root / f"{i:03}.rows.json"
        if not response_file.exists() and not rows_file.exists():
            summary.append({"index": i, "missing": True})
            continue
        response = load(response_file) if response_file.exists() else {}
        rows, invalid = [], []
        for line in visible_text(response).splitlines():
            text = line.strip()
            if not text or text.startswith("```"):
                continue
            row = repair_json(text, return_objects=True)
            if isinstance(row, dict) and number(row.get("start")) and number(row.get("end")):
                # 模型输出分段内时间，换算后整个工作目录只使用整片时间。
                rows.append(
                    {
                        **row,
                        "start": round(row["start"] + segment["start"], 3),
                        "end": round(row["end"] + segment["start"], 3),
                    }
                )
            else:
                invalid.append(text)
        if rows_file.exists():
            rows = load(rows_file)
        else:
            save(rows_file, rows)
        summary.append(
            {
                "index": i,
                "start": segment["start"],
                "end": segment["end"],
                "rows": len(rows),
                "incomplete": response_file.exists()
                and (
                    response.get("status") != "completed"
                    or bool(response.get("incomplete_details"))
                ),
                "invalid_lines": invalid,
                "uncovered_voice": uncovered_voice(root / segment["path"], segment, rows),
            }
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def items(directory):
    """合并各段字幕为包内记录。译文另存为提交材料。"""
    root = Path(directory)
    segments = load(root / "video.json")["segments"]
    rows = []
    for i in range(len(segments)):
        rows_file = root / f"{i:03}.rows.json"
        if not rows_file.exists():
            raise ValueError(f"分段 {i} 尚无识别结果")
        rows += load(rows_file)
    for i, row in enumerate(rows):
        if (
            not (
                number(row.get("start"))
                and number(row.get("end"))
                and 0 <= row["start"] < row["end"] <= segments[-1]["end"]
            )
            or row.get("kind") not in ("dialogue", "screen")
            or not isinstance(row.get("src"), str)
            or not row["src"].strip()
            or not isinstance(row.get("dst"), str)
        ):
            raise ValueError(f"第 {i} 行不合法：{json.dumps(row, ensure_ascii=False)}")
    rows.sort(key=lambda row: row["start"])  # 校验后排序，坏时间不能参与比较。
    save(
        root / "items.json",
        [
            {**{k: v for k, v in row.items() if k not in ("src", "dst")}, "message": row["src"]}
            for row in rows
        ],
    )
    save(
        root / "translations.json",
        [{"row_number": i, "src": row["src"], "dst": row["dst"]} for i, row in enumerate(rows)],
    )
    print(json.dumps({"items": len(rows)}, ensure_ascii=False))


def pack(directory, output):
    """把包目录中的清单、记录、分段和可选的定制渲染程序封装为 .video。"""
    root = Path(directory)
    manifest = load(root / "video.json")
    load(root / "items.json")  # 记录缺失或损坏时不打包。
    members = ["video.json", "items.json", *(segment["path"] for segment in manifest["segments"])]
    if (root / CUSTOM_RENDERER).exists():
        members.append(CUSTOM_RENDERER)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.video")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
        for member in members:
            archive.write(root / member, member)
    if temporary.stat().st_size > PACKAGE_MAX_BYTES:
        temporary.unlink()
        raise ValueError("包超过 900 MiB，请拆分原素材后导入")
    temporary.replace(output)
    print(json.dumps({"package": str(output), "members": len(members)}, ensure_ascii=False))


if __name__ == "__main__":
    # 命令只分发确定性处理，网络请求由工作区主脚本执行。
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("inspect").add_argument("source")
    prep = commands.add_parser("prepare")
    prep.add_argument("source")
    prep.add_argument("directory")
    prep.add_argument("--track", type=int, default=0)
    commands.add_parser("parse").add_argument("directory")
    commands.add_parser("items").add_argument("directory")
    package = commands.add_parser("pack")
    package.add_argument("directory")
    package.add_argument("output")
    args = parser.parse_args()
    if args.command == "inspect":
        print(json.dumps(inspect(args.source), ensure_ascii=False, indent=2))
    elif args.command == "prepare":
        prepare(args.source, args.directory, args.track)
    elif args.command == "parse":
        parse(args.directory)
    elif args.command == "items":
        items(args.directory)
    elif args.command == "pack":
        pack(args.directory, args.output)
