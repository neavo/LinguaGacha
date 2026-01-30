import math
import re
from dataclasses import dataclass, field
from queue import PriorityQueue
from enum import IntEnum

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.ChunkGenerator import ChunkGenerator
from module.Localizer.Localizer import Localizer
from module.Engine.Translator.TranslatorTask import TranslatorTask


class TaskPriority(IntEnum):
    """任务优先级 - 数值越小优先级越高"""

    HIGH = 0
    NORMAL = 1


@dataclass(order=True)
class TaskContext:
    """任务上下文 - 跟踪每个chunk的切分历史"""

    items: list[Item] = field(compare=False)  # 当前chunk包含的items
    precedings: list[Item] = field(compare=False)  # 上文上下文
    token_threshold: int = field(compare=False)  # 当前token阈值
    split_count: int = 0  # 拆分次数
    retry_count: int = 0  # 重试次数（累计）
    is_initial: bool = True  # 是否为初始任务


@dataclass(order=False)
class PriorityQueueItem:
    """队列项"""

    priority: TaskPriority
    context: TaskContext = field(compare=False)
    task: TranslatorTask | None = field(compare=False, default=None)

    def __lt__(self, other):
        if not isinstance(other, PriorityQueueItem):
            return NotImplemented
        return self.priority < other.priority


class TaskScheduler(Base):
    def __init__(self, config: Config, model: dict, items: list[Item]) -> None:
        """初始化任务调度器"""
        super().__init__()
        self.config = config
        self.model = model
        self.items = items

        # 初始token阈值
        self.initial_t0 = self.model.get("threshold", {}).get("input_token_limit", 512)

        # 计算衰减因子 factor = (16 / T0) ^ 0.25
        # 确保 factor 在合理范围内，避免 T0 过小导致的问题
        t0_effective = max(17, self.initial_t0)
        self.factor = math.pow(16 / t0_effective, 0.25)

    def generate_initial_tasks(self) -> list[PriorityQueueItem]:
        """生成初始翻译任务"""
        # 生成缓存数据条目片段
        chunks, precedings = ChunkGenerator.generate_item_chunks(
            items=self.items,
            input_token_threshold=self.initial_t0,
            preceding_lines_threshold=self.config.preceding_lines_threshold,
        )

        queue_items = []
        for chunk_items, chunk_precedings in zip(chunks, precedings):
            context = TaskContext(
                items=chunk_items,
                precedings=chunk_precedings,
                token_threshold=self.initial_t0,
                is_initial=True,
            )

            task = self.create_task(context)
            queue_items.append(
                PriorityQueueItem(
                    priority=TaskPriority.NORMAL, context=context, task=task
                )
            )

        return queue_items

    def handle_failed_task(
        self, queue_item: PriorityQueueItem, result: dict
    ) -> list[PriorityQueueItem]:
        """处理失败任务，返回新的任务列表（可能为空）"""
        context = queue_item.context
        # 仅处理仍然为 NONE 的条目
        items = [i for i in context.items if i.get_status() == Base.ProjectStatus.NONE]

        if not items:
            return []

        # 识别错误类型（此处简化处理，row_count=0 统一视为逻辑/格式错误或需要重试的错误）
        # 实际上 TranslatorTask 内部如果遇到 network error 会返回 row_count=0

        new_tasks = []

        if len(items) > 1:
            # 多条任务失败：降低阈值，执行切分逻辑
            new_threshold = max(1, math.floor(context.token_threshold * self.factor))

            # 如果已经是 1 了，则不再切分，而是将每个 item 作为单条任务
            if context.token_threshold <= 1:
                for item in items:
                    new_context = TaskContext(
                        items=[item],
                        precedings=[],  # 切分后的任务不使用 preceding
                        token_threshold=1,
                        split_count=context.split_count + 1,
                        retry_count=0,
                        is_initial=False,
                    )
                    task = self.create_task(new_context)
                    new_tasks.append(
                        PriorityQueueItem(
                            priority=TaskPriority.HIGH, context=new_context, task=task
                        )
                    )
            else:
                # 重新切分
                sub_chunks, _ = ChunkGenerator.generate_item_chunks(
                    items=items,
                    input_token_threshold=new_threshold,
                    preceding_lines_threshold=0,  # 切分后不使用 preceding
                )

                for sub_chunk in sub_chunks:
                    new_context = TaskContext(
                        items=sub_chunk,
                        precedings=[],
                        token_threshold=new_threshold,
                        split_count=context.split_count + 1,
                        retry_count=0,
                        is_initial=False,
                    )
                    task = self.create_task(new_context)
                    new_tasks.append(
                        PriorityQueueItem(
                            priority=TaskPriority.HIGH, context=new_context, task=task
                        )
                    )
        else:
            # 单条任务失败
            item = items[0]
            if context.retry_count < 3:
                # 重试
                new_context = TaskContext(
                    items=[item],
                    precedings=[],
                    token_threshold=context.token_threshold,
                    split_count=context.split_count,
                    retry_count=context.retry_count + 1,
                    is_initial=False,
                )
                task = self.create_task(new_context)
                new_tasks.append(
                    PriorityQueueItem(
                        priority=TaskPriority.HIGH, context=new_context, task=task
                    )
                )
            else:
                # 强制接受最后一次响应
                # 这里我们假设 TranslatorTask 已经处理了 item 的状态，
                # 但根据 PRD，如果重试耗尽，我们需要确保它被标记为 PROCESSED 并可能使用原文兜底
                self.force_accept(item)

        return new_tasks

    def create_task(self, context: TaskContext) -> TranslatorTask:
        """根据上下文创建 TranslatorTask"""
        # 重新初始化 local_flag，或者从外部传入。这里为了简单直接计算。
        api_url = self.model.get("api_url", "")

        local_flag = (
            re.search(
                r"^http[s]*://localhost|^http[s]*://\d+\.\d+\.\d+\.\d+",
                api_url,
                flags=re.IGNORECASE,
            )
            is not None
        )

        task = TranslatorTask(
            config=self.config,
            model=self.model,
            local_flag=local_flag,
            items=context.items,
            precedings=context.precedings,
            is_sub_task=not context.is_initial,
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

    def should_stop(self, task_queue: PriorityQueue, running_count: int) -> bool:
        """判断是否应该停止生产新任务"""
        # 1. 队列为空
        # 2. 没有正在执行的任务
        # 3. 没有未翻译的 items (status = NONE)
        # 注意：这里的 items 是指 self.items 中的所有条目
        if not task_queue.empty():
            return False

        if running_count > 0:
            return False

        # 如果队列为空且没有正在执行的任务，强制停止
        # 检查是否还有残留的未翻译条目（可能是被异常丢弃的任务）
        untranslated = [
            i for i in self.items if i.get_status() == Base.ProjectStatus.NONE
        ]
        if untranslated:
            self.warning(
                Localizer.get().engine_task_scheduler_stop_with_untranslated.replace(
                    "{COUNT}", str(len(untranslated))
                )
            )

        return True

    def get_untranslated_items(self) -> list[Item]:
        """获取未翻译的 items"""
        return [
            item for item in self.items if item.get_status() == Base.ProjectStatus.NONE
        ]
