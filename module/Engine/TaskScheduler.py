import math
from collections.abc import Iterator
from dataclasses import dataclass, field

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.ChunkGenerator import ChunkGenerator
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.Engine.Translator.TranslatorTask import TranslatorTask


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

    def generate_initial_contexts_iter(self) -> "Iterator[TaskContext]":
        """流式生成初始任务上下文（不创建 TranslatorTask）。"""
        for chunk_items, chunk_precedings in ChunkGenerator.generate_item_chunks_iter(
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
        items = [i for i in context.items if i.get_status() == Base.ProjectStatus.NONE]
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
                sub_chunks = ChunkGenerator.generate_item_chunks(
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

    def create_task(self, context: TaskContext) -> TranslatorTask:
        """根据上下文创建 TranslatorTask"""
        task = TranslatorTask(
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
