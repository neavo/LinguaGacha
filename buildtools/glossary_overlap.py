# 用法：
# uv run --no-sync python buildtools/glossary_overlap.py
#
# 示例：
# 1. 对比默认的 1.json 和 2.json
# uv run --no-sync python buildtools/glossary_overlap.py
#
# 2. 只展示前 10 条结果
# uv run --no-sync python buildtools/glossary_overlap.py --limit 10
#
# 3. 对比自定义文件
# uv run --no-sync python buildtools/glossary_overlap.py a.json b.json --limit 30
#
# 输出内容：
# - 仅在 A：在 A 里有、在 B 里没有
# - 仅在 B：在 B 里有、在 A 里没有
# - 交集：A 和 B 都有
# - 交集中译文不同：A 和 B 的 src 相同，但 dst 不同

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path

import orjson

PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    # 直接运行 buildtools 脚本时，需要把仓库根目录加入模块搜索路径。
    sys.path.insert(0, str(PROJECT_ROOT))

JSONTool = import_module("module.Utils.JSONTool").JSONTool


@dataclass(frozen=True)
class GlossaryEntry:
    """统一术语项结构，方便把不同 JSON 形态压成同一份数据。"""

    src: str
    dst: str


@dataclass(frozen=True)
class CompareResult:
    """保存三类集合和交集中翻译不一致的条目，便于统一输出。"""

    only_in_a: list[GlossaryEntry]
    only_in_b: list[GlossaryEntry]
    intersection: list[tuple[GlossaryEntry, GlossaryEntry]]
    different_dst: list[tuple[GlossaryEntry, GlossaryEntry]]


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(
        description="对比两个 JSON 术语表的覆盖关系与交集差异。",
    )
    parser.add_argument(
        "file_a",
        nargs="?",
        default="1.json",
        help="A 文件路径，默认使用 1.json",
    )
    parser.add_argument(
        "file_b",
        nargs="?",
        default="2.json",
        help="B 文件路径，默认使用 2.json",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="每类结果最多展示多少条，默认 20",
    )
    return parser.parse_args()


def load_entries(path: Path) -> dict[str, GlossaryEntry]:
    """把 JSON 读成以 src 为键的映射。"""

    raw_data: object = load_json_with_repair(path)

    if isinstance(raw_data, list):
        return load_entries_from_list(raw_data, path)

    if isinstance(raw_data, dict):
        return load_entries_from_dict(raw_data, path)

    raise ValueError(f"{path} 的 JSON 顶层必须是 list 或 dict")


def load_json_with_repair(path: Path) -> object:
    """优先按标准 JSON 读取，失败时自动修复常见小问题。"""

    try:
        return JSONTool.load_file(path)
    except json.JSONDecodeError, orjson.JSONDecodeError:
        text: str = path.read_text(encoding="utf-8")
        return JSONTool.repair_loads(text)


def load_entries_from_list(
    raw_data: list[object], path: Path
) -> dict[str, GlossaryEntry]:
    """支持 [{src, dst}, ...] 这种列表结构。"""

    entries: dict[str, GlossaryEntry] = {}

    for index, item in enumerate(raw_data):
        if not isinstance(item, dict):
            raise ValueError(f"{path} 第 {index + 1} 项不是对象")

        src: object = item.get("src")
        dst: object = item.get("dst")
        if not isinstance(src, str) or not isinstance(dst, str):
            raise ValueError(f"{path} 第 {index + 1} 项缺少字符串类型的 src/dst")

        # 后写入覆盖前写入，这样能直接反映文件里的最终有效值。
        entries[src] = GlossaryEntry(src=src, dst=dst)

    return entries


def load_entries_from_dict(
    raw_data: dict[object, object], path: Path
) -> dict[str, GlossaryEntry]:
    """支持 {"src": "dst"} 这种字典结构。"""

    entries: dict[str, GlossaryEntry] = {}

    for src, dst in raw_data.items():
        if not isinstance(src, str) or not isinstance(dst, str):
            raise ValueError(f"{path} 中存在非字符串键值")

        entries[src] = GlossaryEntry(src=src, dst=dst)

    return entries


def compare_entries(
    entries_a: dict[str, GlossaryEntry],
    entries_b: dict[str, GlossaryEntry],
) -> CompareResult:
    """按 src 对比 A/B 的独有项和交集项。"""

    keys_a: set[str] = set(entries_a)
    keys_b: set[str] = set(entries_b)

    only_in_a: list[GlossaryEntry] = sorted(
        (entries_a[key] for key in keys_a - keys_b),
        key=lambda item: item.src,
    )
    only_in_b: list[GlossaryEntry] = sorted(
        (entries_b[key] for key in keys_b - keys_a),
        key=lambda item: item.src,
    )
    intersection_keys: list[str] = sorted(keys_a & keys_b)
    intersection: list[tuple[GlossaryEntry, GlossaryEntry]] = [
        (entries_a[key], entries_b[key]) for key in intersection_keys
    ]
    different_dst: list[tuple[GlossaryEntry, GlossaryEntry]] = [
        (entry_a, entry_b)
        for entry_a, entry_b in intersection
        if entry_a.dst != entry_b.dst
    ]
    return CompareResult(
        only_in_a=only_in_a,
        only_in_b=only_in_b,
        intersection=intersection,
        different_dst=different_dst,
    )


def format_entry(entry: GlossaryEntry) -> str:
    """把条目格式化成统一输出文本。"""

    return f"{entry.src} -> {entry.dst}"


def print_summary(file_a: Path, file_b: Path, result: CompareResult) -> None:
    """先打印总览，让人一眼看明白覆盖关系。"""

    print("=== JSON 覆盖对比 ===")
    print(f"A 文件: {file_a}")
    print(f"B 文件: {file_b}")
    print(f"仅在 A: {len(result.only_in_a)}")
    print(f"仅在 B: {len(result.only_in_b)}")
    print(f"交集: {len(result.intersection)}")
    print(f"交集中译文不同: {len(result.different_dst)}")


def print_entry_list(title: str, entries: list[GlossaryEntry], limit: int) -> None:
    """打印单边独有条目。"""

    print()
    print(f"=== {title}（展示前 {min(limit, len(entries))} 条）===")
    for entry in entries[:limit]:
        print(format_entry(entry))
    if len(entries) > limit:
        print(f"... 还有 {len(entries) - limit} 条未展示")


def print_intersection_list(
    title: str,
    entries: list[tuple[GlossaryEntry, GlossaryEntry]],
    limit: int,
) -> None:
    """打印交集条目，同时展示 A/B 两边的值。"""

    print()
    print(f"=== {title}（展示前 {min(limit, len(entries))} 条）===")
    for entry_a, entry_b in entries[:limit]:
        print(f"{entry_a.src} | A: {entry_a.dst} | B: {entry_b.dst}")
    if len(entries) > limit:
        print(f"... 还有 {len(entries) - limit} 条未展示")


def main() -> None:
    """执行对比并输出结果。"""

    args = parse_args()
    file_a: Path = Path(args.file_a)
    file_b: Path = Path(args.file_b)
    entries_a: dict[str, GlossaryEntry] = load_entries(file_a)
    entries_b: dict[str, GlossaryEntry] = load_entries(file_b)
    result: CompareResult = compare_entries(entries_a, entries_b)

    print_summary(file_a, file_b, result)
    print_entry_list("仅在 A", result.only_in_a, args.limit)
    print_entry_list("仅在 B", result.only_in_b, args.limit)
    print_intersection_list("交集", result.intersection, args.limit)
    print_intersection_list("交集中译文不同", result.different_dst, args.limit)


if __name__ == "__main__":
    main()
