import math
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Engine.TaskModeStrategy import TaskModeStrategy
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.Engine.Translation.TranslationTask import TranslationTask
from module.Utils.GapTool import GapTool

if TYPE_CHECKING:
    from module.Engine.Analysis.AnalysisModels import AnalysisItemContext
    from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext


@dataclass(order=True)
class TaskContext:
    """任务上下文 - 跟踪每个chunk的切分历史"""

    items: list[Item] = field(compare=False)  # 当前chunk包含的items
    precedings: list[Item] = field(compare=False)  # 上文上下文
    token_threshold: int = field(compare=False)  # 当前token阈值
    split_count: int = 0  # 拆分次数
    retry_count: int = 0  # 重试次数（累计）
    is_initial: bool = True  # 是否为初始任务


class TaskScheduler(Base):
    # 统一维护初次切片时的句末标点，避免翻译和分析各写一套边界规则。
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

    def __init__(
        self,
        config: Config,
        model: dict,
        items: list[Item],
        quality_snapshot: QualityRuleSnapshot | None = None,
    ) -> None:
        """初始化任务调度器"""
        super().__init__()
        self.config = config
        self.model = model
        self.items = items
        self.quality_snapshot: QualityRuleSnapshot | None = quality_snapshot

        # 初始token阈值
        self.initial_t0 = self.model.get("threshold", {}).get("input_token_limit", 512)

        # 计算衰减因子 factor = (16 / T0) ^ 0.25
        # 确保 factor 在合理范围内，避免 T0 过小导致的问题
        t0_effective = max(17, self.initial_t0)
        self.factor = math.pow(16 / t0_effective, 0.25)

    @classmethod
    def generate_item_chunks_iter(
        cls,
        items: list[Item],
        input_token_threshold: int,
        preceding_lines_threshold: int,
    ) -> Iterator[tuple[list[Item], list[Item]]]:
        """统一生成初次任务分片，确保翻译和分析共享同一套边界规则。"""
        line_limit = max(8, int(input_token_threshold / 16))

        skip = 0
        line_length = 0
        token_length = 0
        chunk: list[Item] = []

        # 初次大批量切片时定期让出 GIL，避免后台线程把 UI 卡住。
        for i, item in GapTool.iter(enumerate(items)):
            # 初次切片只调度待处理条目，避免不同任务线在入口阶段口径漂移。
            if item.get_status() != Base.ProjectStatus.NONE:
                skip += 1
                continue

            current_line_length = sum(
                1 for line in item.get_src().splitlines() if line.strip()
            )
            current_token_length = item.get_token_count()

            if len(chunk) == 0:
                pass
            elif (
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

        if len(chunk) > 0:
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
        """提供带列表返回值的共享切片入口，方便失败后再次截断时复用。"""
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
        """统一生成上文上下文，保证翻译初次任务和后续截断都走同一套边界。"""
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

    @classmethod
    def build_initial_analysis_contexts(
        cls,
        items: list["AnalysisItemContext"],
        input_token_threshold: int,
    ) -> list["AnalysisTaskContext"]:
        """分析初次切片只复用共享边界，不引入翻译的 preceding 和重试语义。"""
        from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext

        if not items:
            return []

        context_by_id = {item.item_id: item for item in items}
        seed_items = [
            Item(
                id=item.item_id,
                src=item.src_text,
                file_path=item.file_path,
                status=Base.ProjectStatus.NONE,
            )
            for item in items
        ]

        task_contexts: list[AnalysisTaskContext] = []
        for chunk_items, _precedings in cls.generate_item_chunks_iter(
            items=seed_items,
            input_token_threshold=input_token_threshold,
            preceding_lines_threshold=0,
        ):
            chunk_context_list: list["AnalysisItemContext"] = []
            for item in chunk_items:
                item_id = item.get_id()
                if not isinstance(item_id, int):
                    continue

                context = context_by_id.get(item_id)
                if context is None:
                    continue
                chunk_context_list.append(context)

            chunk_contexts = tuple(chunk_context_list)
            if not chunk_contexts:
                continue

            task_contexts.append(
                AnalysisTaskContext(
                    file_path=chunk_contexts[0].file_path,
                    items=chunk_contexts,
                )
            )
        return task_contexts

    def generate_initial_contexts_iter(self) -> "Iterator[TaskContext]":
        """流式生成初始任务上下文（不创建 TranslationTask）。"""
        for chunk_items, chunk_precedings in self.generate_item_chunks_iter(
            items=self.items,
            input_token_threshold=self.initial_t0,
            preceding_lines_threshold=self.config.preceding_lines_threshold,
        ):
            yield TaskContext(
                items=chunk_items,
                precedings=chunk_precedings,
                token_threshold=self.initial_t0,
                is_initial=True,
            )

    def handle_failed_context(
        self, context: TaskContext, result: dict
    ) -> list[TaskContext]:
        """处理失败任务上下文，返回新的上下文列表（可能为空）。"""
        items = [
            item
            for item in context.items
            if TaskModeStrategy.should_schedule_continue(item.get_status())
        ]
        if not items:
            return []

        new_contexts: list[TaskContext] = []

        if len(items) > 1:
            new_threshold = max(1, math.floor(context.token_threshold * self.factor))

            if context.token_threshold <= 1:
                for item in items:
                    new_contexts.append(
                        TaskContext(
                            items=[item],
                            precedings=[],
                            token_threshold=1,
                            split_count=context.split_count + 1,
                            retry_count=0,
                            is_initial=False,
                        )
                    )
            else:
                # 拆分后的子任务不携带上文，避免错误上下文干扰拆分/重试。
                sub_chunks = self.generate_item_chunks(
                    items=items,
                    input_token_threshold=new_threshold,
                    preceding_lines_threshold=0,
                )[0]
                for sub_chunk in sub_chunks:
                    new_contexts.append(
                        TaskContext(
                            items=sub_chunk,
                            precedings=[],
                            token_threshold=new_threshold,
                            split_count=context.split_count + 1,
                            retry_count=0,
                            is_initial=False,
                        )
                    )
        else:
            item = items[0]
            if context.retry_count < 3:
                new_contexts.append(
                    TaskContext(
                        items=[item],
                        precedings=[],
                        token_threshold=context.token_threshold,
                        split_count=context.split_count,
                        retry_count=context.retry_count + 1,
                        is_initial=False,
                    )
                )
            else:
                self.force_accept(item)

        return new_contexts

    def create_task(self, context: TaskContext) -> TranslationTask:
        """根据上下文创建 TranslationTask"""
        task = TranslationTask(
            config=self.config,
            model=self.model,
            items=context.items,
            precedings=context.precedings,
            is_sub_task=not context.is_initial,
            quality_snapshot=self.quality_snapshot,
        )
        # 注入详细状态用于日志
        task.split_count = context.split_count
        task.token_threshold = context.token_threshold
        task.retry_count = context.retry_count

        return task

    def force_accept(self, item: Item) -> None:
        """强制接受任务（由于多次重试失败）"""
        if item.get_status() not in (
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.ERROR,
        ):
            if not item.get_dst():
                item.set_dst(item.get_src())
            item.set_status(Base.ProjectStatus.ERROR)
