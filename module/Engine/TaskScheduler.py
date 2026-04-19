from __future__ import annotations

from collections.abc import Iterator

from base.Base import Base
from module.Data.Core.Item import Item
from module.Utils.GapTool import GapTool


class TaskScheduler:
    """共享切块工具只负责边界规则，不再持有翻译或分析的领域状态。"""

    END_LINE_PUNCTUATION: tuple[str, ...] = (
        ".",
        "。",
        "?",
        "？",
        "!",
        "！",
        "…",
        "'",
        '"',
        "」",
        "』",
    )

    @classmethod
    def generate_item_chunks_iter(
        cls,
        items: list[Item],
        input_token_threshold: int,
        preceding_lines_threshold: int,
    ) -> Iterator[tuple[list[Item], list[Item]]]:
        """共享生成初次任务分片，保证两条任务线使用同一套边界规则。"""
        line_limit = max(8, int(input_token_threshold / 16))

        skip = 0
        line_length = 0
        token_length = 0
        chunk: list[Item] = []

        for i, item in GapTool.iter(enumerate(items)):
            if item.get_status() != Base.ProjectStatus.NONE:
                skip += 1
                continue

            current_line_length = sum(
                1 for line in item.get_src().splitlines() if line.strip()
            )
            current_token_length = item.get_token_count()

            if chunk and (
                line_length + current_line_length > line_limit
                or token_length + current_token_length > input_token_threshold
                or item.get_file_path() != chunk[-1].get_file_path()
            ):
                preceding = cls.generate_preceding_chunk(
                    items=items,
                    chunk=chunk,
                    start=i,
                    skip=skip,
                    preceding_lines_threshold=preceding_lines_threshold,
                )
                yield chunk, preceding

                skip = 0
                chunk = []
                line_length = 0
                token_length = 0

            chunk.append(item)
            line_length += current_line_length
            token_length += current_token_length

        if chunk:
            preceding = cls.generate_preceding_chunk(
                items=items,
                chunk=chunk,
                start=len(items),
                skip=skip,
                preceding_lines_threshold=preceding_lines_threshold,
            )
            yield chunk, preceding

    @classmethod
    def generate_item_chunks(
        cls,
        items: list[Item],
        input_token_threshold: int,
        preceding_lines_threshold: int,
    ) -> tuple[list[list[Item]], list[list[Item]]]:
        """列表版共享切块入口，方便领域调度器在重试时复用。"""
        chunks: list[list[Item]] = []
        preceding_chunks: list[list[Item]] = []
        for chunk, preceding in cls.generate_item_chunks_iter(
            items=items,
            input_token_threshold=input_token_threshold,
            preceding_lines_threshold=preceding_lines_threshold,
        ):
            chunks.append(chunk)
            preceding_chunks.append(preceding)
        return chunks, preceding_chunks

    @classmethod
    def generate_preceding_chunk(
        cls,
        items: list[Item],
        chunk: list[Item],
        start: int,
        skip: int,
        preceding_lines_threshold: int,
    ) -> list[Item]:
        """共享生成上文块，确保翻译和分析都沿用同一套句边界规则。"""
        result: list[Item] = []
        for i in range(start - skip - len(chunk) - 1, -1, -1):
            item = items[i]

            if item.get_status() in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.RULE_SKIPPED,
                Base.ProjectStatus.LANGUAGE_SKIPPED,
            ):
                continue

            src = item.get_src().strip()
            if src == "":
                continue

            if len(result) >= preceding_lines_threshold:
                break

            if item.get_file_path() != chunk[-1].get_file_path():
                break

            if src.endswith(cls.END_LINE_PUNCTUATION):
                result.append(item)
            else:
                break

        return result[::-1]
