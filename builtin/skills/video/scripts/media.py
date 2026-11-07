"""视频技能的确定性处理；网络和凭据由工作区宿主负责。"""

import argparse
import json
import math
import re
import subprocess
import tempfile
import zipfile
from difflib import SequenceMatcher
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
PACKAGE_MAX_BYTES = 900 * 1024 * 1024
DISCARD_RATIO = 0.1
UNCOVERED_SECONDS = 5
SCREEN_MERGE_SECONDS = 1
REPETITION_SIMILARITY = 0.9


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
    """整片只计算一次能量曲线，供切段与覆盖检查复用。"""
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
    """固定来源身份后转码，已发布的分段可以续用。"""
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
    state_file = root / "state.json"
    if state_file.exists():
        state = load(state_file)
        if state["source"] != identity:
            raise ValueError("来源或音轨已变化，请使用新的工作目录")
    else:
        db = energy(source, track) if info["audio"] else None
        boundaries = cuts(info["duration"], db)
        state = {
            "source": identity,
            "video": info["video"],
            "segments": [
                {"path": f"segments/{i:03}.mp4", "start": start, "end": end}
                for i, (start, end) in enumerate(pairwise(boundaries))
            ],
            "energy": db.tolist() if db is not None else None,
        }
        save(state_file, state)
    for i, segment in enumerate(state["segments"]):
        target = root / segment["path"]
        if target.exists():
            continue
        target.parent.mkdir(exist_ok=True)
        temporary = target.with_suffix(".tmp.mp4")
        args = ["-v", "error", "-y", "-ss", str(segment["start"]), "-i", str(source)]
        if state["video"] is None:
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
        if state["video"] is None:
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
        print(f"转码 {i + 1}/{len(state['segments'])}", flush=True)


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


def analyze(response, segment, db):
    """保留合法行并报告问题，重试决策只针对整段失败。"""
    text = visible_text(response)
    rows, discarded, flags = [], 0, []
    duration = segment["end"] - segment["start"]
    previous = 0
    for line in text.splitlines():
        if not line.strip() or line.strip().startswith("```"):
            continue
        try:
            row = repair_json(line, return_objects=True)
            if (
                not isinstance(row, dict)
                or row.get("kind") not in ("dialogue", "screen")
                or not all(isinstance(row.get(key), str) for key in ("src", "dst"))
                or not all(number(row.get(key)) for key in ("start", "end"))
            ):
                raise ValueError("结构错误")
        except (ValueError, TypeError):
            discarded += 1
            continue
        index = len(rows)
        if not 0 <= row["start"] < row["end"] <= duration or row["start"] < previous:
            flags.append({"row": index, "reason": "time"})
        previous = row["start"]
        if not row["src"].strip() or not row["dst"].strip():
            flags.append({"row": index, "reason": "empty_pair"})
        span = row["end"] - row["start"]
        if span > 7 or (span > 0 and len(row["src"]) / span > 30):
            flags.append({"row": index, "reason": "granularity"})
        if row["src"] == row["dst"]:
            flags.append({"row": index, "reason": "same_text"})
        if len(rows) >= 2 and all(
            SequenceMatcher(None, row["src"], previous_row["src"]).ratio() >= REPETITION_SIMILARITY
            for previous_row in rows[-2:]
        ):
            flags.append({"row": index, "reason": "repetition"})
        rows.append({key: row[key] for key in ("start", "end", "kind", "src", "dst")})
    active = (
        np.array([], dtype=bool)
        if db is None
        else np.asarray(db[round(segment["start"] * 10) : math.ceil(segment["end"] * 10)])
        >= SILENCE_DB
    )
    uncovered = active.copy()
    for row in rows:
        if row["kind"] == "dialogue":
            uncovered[max(0, int(row["start"] * 10)) : max(0, math.ceil(row["end"] * 10))] = False
    longest = current = 0
    for value in uncovered:
        current = current + 1 if value else 0
        longest = max(longest, current)
    if longest * HOP_SECONDS >= UNCOVERED_SECONDS:
        flags.append({"reason": "possible_missing_speech"})
    # 音乐同样会触发能量检查，疑似漏句交给 Agent 复核。
    retry = (
        response.get("status") != "completed"
        or bool(response.get("incomplete_details"))
        or (not text.strip() and bool(active.any()))
        or discarded / max(1, len(rows) + discarded) > DISCARD_RATIO
        or any(flag["reason"] == "repetition" for flag in flags)
    )
    return {"rows": rows, "discarded": discarded, "flags": flags, "retry": retry}


def analyze_files(directory):
    """只解析尚未发布的结果，续跑保留人工修正。"""
    root = Path(directory)
    state = load(root / "state.json")
    summary = []
    for i, segment in enumerate(state["segments"]):
        raw = root / f"{i:03}.response.json"
        parsed = root / f"{i:03}.parsed.json"
        if parsed.exists():
            result = load(parsed)
        elif raw.exists():
            result = analyze(load(raw), segment, state["energy"])
            save(parsed, result)
        else:
            summary.append({"index": i, "missing": True})
            continue
        summary.append(
            {"index": i, **{key: value for key, value in result.items() if key != "rows"}}
        )
    save(root / "review.json", summary)


def pack(directory, output):
    """合并原文字幕并发布独立译文表，包内不保存译文。"""
    root = Path(directory)
    state = load(root / "state.json")
    cues = []
    for i, segment in enumerate(state["segments"]):
        parsed = load(root / f"{i:03}.parsed.json")
        if parsed["retry"] or parsed["discarded"]:
            raise ValueError(f"分段 {i} 尚有未解决的检查问题")
        for row in parsed["rows"]:
            if (
                not all(number(row.get(key)) for key in ("start", "end"))
                or not 0 <= row["start"] < row["end"] <= segment["end"] - segment["start"]
                or row["kind"] not in ("dialogue", "screen")
                or not row["src"].strip()
                or not row["dst"].strip()
            ):
                raise ValueError(f"分段 {i} 字幕不合法")
            cues.append(
                {
                    **row,
                    "start": row["start"] + segment["start"],
                    "end": min(row["end"] + segment["start"], segment["end"]),
                }
            )
    # 保留亚百分秒时间，ASS 生成时才按输出精度取整。
    cues.sort(key=lambda row: row["start"])
    merged, screens = [], {}  # 每条画面文字只与最近的同文字幕合并。
    for cue in cues:
        previous = screens.get(cue["src"]) if cue["kind"] == "screen" else None
        if (
            previous is not None
            and cue["start"] <= previous["end"] + SCREEN_MERGE_SECONDS
            and cue["dst"] == previous["dst"]
        ):
            previous["end"] = max(previous["end"], cue["end"])
        else:
            merged.append(cue)
            if cue["kind"] == "screen":
                screens[cue["src"]] = cue
    manifest = {
        "video": state["video"],
        "segments": state["segments"],
        "cues": [
            {"start": cue["start"], "end": cue["end"], "kind": cue["kind"], "text": cue["src"]}
            for cue in merged
        ],
    }
    video = manifest["video"]
    if video is not None and (
        not isinstance(video, dict)
        or set(video) != {"width", "height"}
        or any(type(value) is not int or value <= 0 for value in video.values())
    ):
        raise ValueError("原视频尺寸不合法")
    if not manifest["segments"]:
        raise ValueError("缺少分段")
    end = 0
    paths = set()
    for segment in manifest["segments"]:
        if (
            not all(number(segment[key]) for key in ("start", "end"))
            or segment["start"] != end
            or segment["end"] <= end
            or not re.fullmatch(r"segments/[^/\\]+\.mp4", segment["path"])
            or segment["path"] in paths
            or not (root / segment["path"]).is_file()
        ):
            raise ValueError("分段清单不合法")
        paths.add(segment["path"])
        end = segment["end"]
    if any(cue["end"] > end for cue in merged):
        raise ValueError("字幕超出素材时长")
    payload = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
    if (
        sum((root / segment["path"]).stat().st_size for segment in manifest["segments"])
        + len(payload)
        > PACKAGE_MAX_BYTES
    ):
        raise ValueError("包超过 900 MiB，请拆分原素材后导入")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.video")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("video.json", payload)
        for segment in manifest["segments"]:
            archive.write(root / segment["path"], segment["path"])
    if temporary.stat().st_size > PACKAGE_MAX_BYTES:
        temporary.unlink()
        raise ValueError("包超过 900 MiB，请拆分原素材后导入")
    temporary.replace(output)
    save(
        root / "translations.json",
        [{"row_number": i, "src": cue["src"], "dst": cue["dst"]} for i, cue in enumerate(merged)],
    )
    print(json.dumps({"package": str(output), "cues": len(merged)}, ensure_ascii=False))


if __name__ == "__main__":
    # 命令只分发确定性处理，网络请求由工作区主脚本执行。
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    probe = commands.add_parser("inspect")
    probe.add_argument("source")
    prep = commands.add_parser("prepare")
    prep.add_argument("source")
    prep.add_argument("directory")
    prep.add_argument("--track", type=int, default=0)
    check = commands.add_parser("analyze")
    check.add_argument("directory")
    package = commands.add_parser("pack")
    package.add_argument("directory")
    package.add_argument("output")
    args = parser.parse_args()
    if args.command == "inspect":
        print(json.dumps(inspect(args.source), ensure_ascii=False, indent=2))
    elif args.command == "prepare":
        prepare(args.source, args.directory, args.track)
    elif args.command == "analyze":
        analyze_files(args.directory)
    elif args.command == "pack":
        pack(args.directory, args.output)
