from base.Base import Base
from model.Item import Item


class ChunkGenerator:
    """翻译任务分片生成器 - 将条目列表拆分为可处理的批次"""

    # 上下文边界检测的结尾标点符号
    END_LINE_PUNCTUATION = (
        ".",
        "。",
        "?",
        "？",
        "!",
        "！",
        "…",
        "'",
        '"',
        "'",
        '"',
        "」",
        "』",
    )

    @classmethod
    def generate_item_chunks(
        cls,
        items: list[Item],
        input_token_threshold: int,
        preceding_lines_threshold: int,
    ) -> tuple[list[list[Item]], list[list[Item]]]:
        """生成翻译任务分片及对应的上文上下文"""
        # 根据 Token 阈值计算行数阈值，避免大量短句导致行数太多
        line_limit = max(8, int(input_token_threshold / 16))

        skip: int = 0
        line_length: int = 0
        token_length: int = 0
        chunk: list[Item] = []
        chunks: list[list[Item]] = []
        preceding_chunks: list[list[Item]] = []

        for i, item in enumerate(items):
            # 跳过状态不是 未翻译 的数据
            if item.get_status() != Base.ProjectStatus.NONE:
                skip = skip + 1
                continue

            # 每个片段的第一条不判断是否超限，以避免特别长的文本导致死循环
            current_line_length = sum(
                1 for line in item.get_src().splitlines() if line.strip()
            )
            current_token_length = item.get_token_count()

            if len(chunk) == 0:
                pass
            # 如果 行数超限、Token 超限、数据来源跨文件，则结束此片段
            elif (
                line_length + current_line_length > line_limit
                or token_length + current_token_length > input_token_threshold
                or item.get_file_path() != chunk[-1].get_file_path()
            ):
                chunks.append(chunk)
                preceding_chunks.append(
                    cls.generate_preceding_chunk(
                        items, chunk, i, skip, preceding_lines_threshold
                    )
                )
                skip = 0

                chunk = []
                line_length = 0
                token_length = 0

            chunk.append(item)
            line_length = line_length + current_line_length
            token_length = token_length + current_token_length

        # 如果还有剩余数据，则添加到列表中
        if len(chunk) > 0:
            chunks.append(chunk)
            preceding_chunks.append(
                cls.generate_preceding_chunk(
                    items, chunk, len(items), skip, preceding_lines_threshold
                )
            )

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
        """为单个分片生成上文上下文"""
        result: list[Item] = []

        for i in range(start - skip - len(chunk) - 1, -1, -1):
            item = items[i]

            # 跳过 已排除 的数据
            if item.get_status() == Base.ProjectStatus.EXCLUDED:
                continue

            # 跳过空数据
            src = item.get_src().strip()
            if src == "":
                continue

            # 候选数据超过阈值时，结束搜索
            if len(result) >= preceding_lines_threshold:
                break

            # 候选数据与当前任务不在同一个文件时，结束搜索
            if item.get_file_path() != chunk[-1].get_file_path():
                break

            # 候选数据以指定标点结尾时，添加到结果中
            if src.endswith(cls.END_LINE_PUNCTUATION):
                result.append(item)
            else:
                break

        # 简单逆序
        return result[::-1]
