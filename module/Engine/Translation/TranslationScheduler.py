from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass
from dataclasses import field

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
from module.Engine.TaskModeStrategy import TaskModeStrategy
from module.Engine.TaskScheduler import TaskScheduler
from module.Engine.Translation.TranslationTask import TranslationTask
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot


@dataclass(order=True)
class TaskContext:
    """翻译任务上下文，统一描述一个 chunk 的边界与重试历史。"""

    items: list[Item] = field(compare=False)
    precedings: list[Item] = field(compare=False)
    token_threshold: int = field(compare=False)
    split_count: int = 0
    retry_count: int = 0
    is_initial: bool = True


class TranslationScheduler:
    """翻译调度器统一管理切块、重试和 TranslationTask 创建。"""

    def __init__(
        self,
        config: Config,
        model: dict,
        items: list[Item],
        quality_snapshot: QualityRuleSnapshot | None = None,
    ) -> None:
        self.config = config
        self.model = model
        self.items = items
        self.quality_snapshot = quality_snapshot

        self.initial_t0 = self.model.get("threshold", {}).get("input_token_limit", 512)
        t0_effective = max(17, self.initial_t0)
        self.factor = math.pow(16 / t0_effective, 0.25)

    @staticmethod
    def create_context(
        *,
        items: list[Item],
        precedings: list[Item],
        token_threshold: int,
        split_count: int = 0,
        retry_count: int = 0,
        is_initial: bool,
    ) -> TaskContext:
        """上下文构造统一收口，避免初始任务和重试任务字段口径漂移。"""
        return TaskContext(
            items=items,
            precedings=precedings,
            token_threshold=token_threshold,
            split_count=split_count,
            retry_count=retry_count,
            is_initial=is_initial,
        )

    def generate_initial_contexts_iter(self) -> Iterator[TaskContext]:
        """初始任务按共享切块规则流式生成，避免一次性创建过多 Task。"""
        for chunk_items, chunk_precedings in TaskScheduler.generate_item_chunks_iter(
            items=self.items,
            input_token_threshold=self.initial_t0,
            preceding_lines_threshold=self.config.preceding_lines_threshold,
        ):
            yield self.create_context(
                items=chunk_items,
                precedings=chunk_precedings,
                token_threshold=self.initial_t0,
                is_initial=True,
            )

    def handle_failed_context(
        self,
        context: TaskContext,
        result: dict,
    ) -> list[TaskContext]:
        """失败后统一在这里做拆分和重试，保证调度语义只有一处。"""
        del result
        items = [
            item
            for item in context.items
            if TaskModeStrategy.should_schedule_continue(item.get_status())
        ]
        if not items:
            return []

        new_contexts: list[TaskContext] = []
        if len(items) == 1:
            item = items[0]
            if context.retry_count < 3:
                new_contexts.append(
                    self.create_context(
                        items=[item],
                        precedings=[],
                        token_threshold=context.token_threshold,
                        split_count=context.split_count,
                        retry_count=context.retry_count + 1,
                        is_initial=False,
                    )
                )
                return new_contexts

            self.force_accept(item)
            return new_contexts

        new_threshold = max(1, math.floor(context.token_threshold * self.factor))
        split_count = context.split_count + 1
        if context.token_threshold <= 1:
            for item in items:
                new_contexts.append(
                    self.create_context(
                        items=[item],
                        precedings=[],
                        token_threshold=1,
                        split_count=split_count,
                        retry_count=0,
                        is_initial=False,
                    )
                )
            return new_contexts

        sub_chunks, _precedings = TaskScheduler.generate_item_chunks(
            items=items,
            input_token_threshold=new_threshold,
            preceding_lines_threshold=0,
        )
        for sub_chunk in sub_chunks:
            new_contexts.append(
                self.create_context(
                    items=sub_chunk,
                    precedings=[],
                    token_threshold=new_threshold,
                    split_count=split_count,
                    retry_count=0,
                    is_initial=False,
                )
            )

        return new_contexts

    def create_task(self, context: TaskContext) -> TranslationTask:
        """统一构造 TranslationTask，并把调度元数据注入日志字段。"""
        task = TranslationTask(
            config=self.config,
            model=self.model,
            items=context.items,
            precedings=context.precedings,
            is_sub_task=not context.is_initial,
            quality_snapshot=self.quality_snapshot,
        )
        task.split_count = context.split_count
        task.token_threshold = context.token_threshold
        task.retry_count = context.retry_count
        return task

    def force_accept(self, item: Item) -> None:
        """重试超限后统一标成错误，避免不同路径收口不一致。"""
        if item.get_status() in (
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.ERROR,
        ):
            return

        if not item.get_dst():
            item.set_dst(item.get_src())
        item.set_status(Base.ProjectStatus.ERROR)
