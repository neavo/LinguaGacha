from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING
from typing import Any

from base.Base import Base
from base.LogManager import LogManager
from module.Engine.Engine import Engine
from module.Engine.TaskPipeline import TaskPipelineCommitResult
from module.Localizer.Localizer import Localizer

if TYPE_CHECKING:
    from module.Engine.Translation.Translation import Translation
    from module.Engine.Translation.TranslationTask import TranslationTask
    from module.Engine.Translation.TranslationScheduler import TaskContext


@dataclass(frozen=True)
class TranslationCommitPayload:
    """翻译 worker 把执行结果交给 commit loop 的最小载荷。"""

    context: TaskContext
    task: TranslationTask
    result: dict[str, Any]


class TranslationTaskHooks:
    """翻译链路的 hooks 适配层。"""

    HIGH_QUEUE_MAX: int = 16384
    HIGH_QUEUE_MULTIPLIER: int = 8

    def __init__(
        self,
        *,
        translation: Translation,
        progress: Any,
        pid: int,
        max_workers: int,
    ) -> None:
        self.translation = translation
        self.progress = progress
        self.pid = pid
        self.max_workers = max_workers

    def should_stop(self) -> bool:
        """翻译停止口径统一收口，避免 hooks 直接依赖引擎细节。"""
        return self.translation.should_stop()

    def get_producer_thread_name(self) -> str:
        """翻译 producer 线程名固定，方便排查生成侧卡点。"""
        return f"{Engine.TASK_PREFIX}TRANSLATION_PRODUCER"

    def get_worker_thread_name_prefix(self) -> str:
        """翻译 worker 线程名前缀固定，便于日志和线程查看。"""
        return f"{Engine.TASK_PREFIX}TRANSLATION_WORKER"

    def build_pipeline_sizes(self) -> tuple[int, int, int]:
        """队列容量沿用翻译既有经验值，避免一次性创建海量任务。"""
        buffer_size = self.translation.get_task_buffer_size(self.max_workers)
        high_queue_size = min(
            self.HIGH_QUEUE_MAX,
            buffer_size * self.HIGH_QUEUE_MULTIPLIER,
        )
        return buffer_size, high_queue_size, buffer_size

    def iter_initial_contexts(self) -> Any:
        """初始任务上下文继续走调度器的流式生成接口。"""
        return self.translation.scheduler.generate_initial_contexts_iter()

    def start_task(self, context: TaskContext) -> TranslationCommitPayload | None:
        """真正创建并启动翻译任务的入口统一收口，避免限流分支重复。"""
        scheduler = self.translation.scheduler
        if scheduler is None:
            return None

        task = scheduler.create_task(context)
        result = task.start()
        return TranslationCommitPayload(
            context=context,
            task=task,
            result=result,
        )

    def run_context(self, context: TaskContext) -> TranslationCommitPayload | None:
        """worker 负责执行翻译请求，把提交材料交给 commit loop。"""
        if self.should_stop():
            return None

        task_limiter = self.translation.task_limiter
        if task_limiter is None:
            return None

        acquired = task_limiter.acquire(self.should_stop)
        if not acquired:
            return None

        try:
            waited = task_limiter.wait(self.should_stop)
            if not waited or self.should_stop():
                return None

            return self.start_task(context)
        finally:
            task_limiter.release()

    def build_retry_contexts(
        self,
        context: TaskContext,
        task: TranslationTask,
        result: dict[str, Any],
    ) -> tuple[TaskContext, ...]:
        """失败后的拆分与重试统一在提交线程生成，保持顺序稳定。"""
        if self.should_stop():
            return tuple()

        if not any(i.get_status() == Base.ProjectStatus.NONE for i in task.items):
            return tuple()

        scheduler = self.translation.scheduler
        if scheduler is None:
            return tuple()

        return tuple(scheduler.handle_failed_context(context, result))

    def build_finalized_items(self, task: TranslationTask) -> list[dict[str, Any]]:
        """只把已进入终态的条目交给数据层，避免把中间态写脏。"""
        return [
            item.to_dict()
            for item in task.items
            if item.get_status()
            in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR)
        ]

    def build_processed_count(self, task: TranslationTask) -> int:
        """统一统计成功数，避免提交阶段分支各算一遍。"""
        return sum(
            1
            for item in task.items
            if item.get_status() == Base.ProjectStatus.PROCESSED
        )

    def build_error_count(self, task: TranslationTask) -> int:
        """统一统计失败数，保证进度累计和最终回写口径一致。"""
        return sum(
            1 for item in task.items if item.get_status() == Base.ProjectStatus.ERROR
        )

    def handle_commit_payloads(
        self,
        payloads: tuple[TranslationCommitPayload, ...],
    ) -> TaskPipelineCommitResult[TaskContext]:
        """翻译提交阶段按批次落库和发进度，减少热路径事务与事件频率。"""
        retry_contexts: list[TaskContext] = []
        finalized_items: list[dict[str, Any]] = []
        processed_count = 0
        error_count = 0
        input_tokens = 0
        output_tokens = 0

        for payload in payloads:
            retry_contexts.extend(
                self.build_retry_contexts(
                    payload.context,
                    payload.task,
                    payload.result,
                )
            )
            finalized_items.extend(self.build_finalized_items(payload.task))
            processed_count += self.build_processed_count(payload.task)
            error_count += self.build_error_count(payload.task)
            input_tokens += int(payload.result.get("input_tokens", 0) or 0)
            output_tokens += int(payload.result.get("output_tokens", 0) or 0)

        extras_snapshot = self.translation.update_extras_snapshot(
            processed_count=processed_count,
            error_count=error_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

        self.translation.apply_batch_update_sync(
            finalized_items,
            extras_snapshot,
        )
        self.translation.update_pipeline_progress(extras_snapshot)
        return TaskPipelineCommitResult(retry_contexts=tuple(retry_contexts))

    def stop_engine_after_error(self, e: Exception) -> None:
        """框架级异常统一走同一收口，避免每个回调都重复停机逻辑。"""
        LogManager.get().error(Localizer.get().task_failed, e)
        Engine.get().set_status(Base.TaskStatus.STOPPING)

    def on_producer_error(self, e: Exception) -> None:
        """生产阶段出错说明调度器已失真，这里直接停机。"""
        self.stop_engine_after_error(e)

    def on_worker_error(self, context: TaskContext, e: Exception) -> None:
        """worker 未预期异常统一进入停止态，避免数据写入顺序失控。"""
        del context
        self.stop_engine_after_error(e)

    def on_commit_error(
        self,
        payloads: tuple[TranslationCommitPayload, ...],
        e: Exception,
    ) -> None:
        """提交阶段异常会影响一致性，这里直接切到停止态。"""
        del payloads
        self.stop_engine_after_error(e)

    def on_worker_loop_error(self, e: Exception) -> None:
        """worker 主循环异常属于框架级故障，必须立刻停机。"""
        self.stop_engine_after_error(e)
