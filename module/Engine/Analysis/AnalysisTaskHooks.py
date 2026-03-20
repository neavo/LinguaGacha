from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from base.Base import Base
from base.LogManager import LogManager
from module.Data.DataManager import DataManager
from module.Engine.Analysis.AnalysisModels import AnalysisTaskContext
from module.Engine.Analysis.AnalysisModels import AnalysisTaskResult
from module.Engine.Engine import Engine
from module.Engine.TaskPipeline import TaskPipelineCommitResult
from module.Localizer.Localizer import Localizer

if TYPE_CHECKING:
    from module.Engine.Analysis.Analysis import Analysis


@dataclass(frozen=True)
class AnalysisCommitPayload:
    """分析 worker 把执行结果交给 commit loop 的最小提交载荷。"""

    result: AnalysisTaskResult


class AnalysisTaskHooks:
    """分析链路的 hooks 适配层只保留 TaskPipeline 需要的边界方法。"""

    HIGH_QUEUE_MAX: int = 16384
    HIGH_QUEUE_MULTIPLIER: int = 8

    def __init__(
        self,
        *,
        analysis: Analysis,
        initial_contexts: list[AnalysisTaskContext],
        max_workers: int,
    ) -> None:
        self.analysis = analysis
        self.initial_contexts = list(initial_contexts)
        self.max_workers = max_workers

    def should_stop(self) -> bool:
        """分析停止口径统一委托控制器，避免 hooks 直接依赖引擎细节。"""
        return self.analysis.should_stop()

    def get_producer_thread_name(self) -> str:
        """分析 producer 线程名固定，方便排查生成侧卡点。"""
        return f"{Engine.TASK_PREFIX}ANALYSIS_PRODUCER"

    def get_worker_thread_name_prefix(self) -> str:
        """分析 worker 线程名前缀固定，便于日志和线程查看。"""
        return f"{Engine.TASK_PREFIX}ANALYSIS_WORKER"

    def iter_initial_contexts(self) -> list[AnalysisTaskContext]:
        """初始任务直接复用 build_plan 阶段生成好的稳定上下文列表。"""
        return list(self.initial_contexts)

    def build_pipeline_sizes(self) -> tuple[int, int, int]:
        """分析队列容量沿用翻译经验值，避免一次性创建海量任务。"""
        buffer_size = max(64, min(4096, self.max_workers * 4))
        high_queue_size = min(
            self.HIGH_QUEUE_MAX, buffer_size * self.HIGH_QUEUE_MULTIPLIER
        )
        return buffer_size, high_queue_size, buffer_size

    def start_task(self, context: AnalysisTaskContext) -> AnalysisCommitPayload | None:
        """真正创建并启动任务的入口统一收口，避免限流分支各做一遍。"""
        scheduler = self.analysis.scheduler
        if scheduler is None:
            return None

        task = scheduler.create_task(context)
        return AnalysisCommitPayload(result=task.start())

    def run_context(self, context: AnalysisTaskContext) -> AnalysisCommitPayload | None:
        """worker 负责请求执行，把提交材料交给 commit loop。"""
        if self.should_stop():
            return None

        limiter = self.analysis.task_limiter
        if limiter is not None:
            if not limiter.acquire(stop_checker=self.analysis.should_stop):
                return None
            try:
                if not limiter.wait(stop_checker=self.analysis.should_stop):
                    return None
                return self.start_task(context)
            finally:
                limiter.release()

        return self.start_task(context)

    def handle_commit_payloads(
        self,
        payloads: tuple[AnalysisCommitPayload, ...],
    ) -> TaskPipelineCommitResult[AnalysisTaskContext]:
        """分析提交阶段统一按批次落库、重试和触发进度节流。"""
        scheduler = self.analysis.scheduler
        if scheduler is None:
            return TaskPipelineCommitResult(failed=True)

        tracker = self.analysis.progress_tracker
        retry_contexts: list[AnalysisTaskContext] = []
        success_checkpoints: list[dict[str, object]] = []
        error_checkpoints: list[dict[str, object]] = []
        glossary_entries: list[dict[str, object]] = []
        failed = False
        stopped = False
        total_input_tokens = 0
        total_output_tokens = 0

        for payload in payloads:
            result = payload.result
            total_input_tokens += result.input_tokens
            total_output_tokens += result.output_tokens

            if result.success:
                tracker.update_runtime_counts_after_success(result)
                success_checkpoints.extend(
                    scheduler.build_processed_checkpoints(result.context)
                )
                glossary_entries.extend(list(result.glossary_entries))
                continue

            if result.stopped:
                stopped = True
                continue

            retry_context = scheduler.create_retry_task_context(result.context)
            if retry_context is not None:
                retry_contexts.append(retry_context)
                continue

            tracker.update_runtime_counts_after_error(result.context)
            error_checkpoints.extend(scheduler.build_error_checkpoints(result.context))
            failed = True

        tracker.update_extras_after_batch(
            input_tokens=total_input_tokens,
            output_tokens=total_output_tokens,
        )
        tracker.mark_progress_dirty(commit_count=len(payloads))

        if success_checkpoints or error_checkpoints or glossary_entries:
            DataManager.get().commit_analysis_task_batch(
                success_checkpoints=success_checkpoints,
                error_checkpoints=error_checkpoints,
                glossary_entries=glossary_entries,
                progress_snapshot=None,
            )

        tracker.sync_progress_snapshot_after_commit(force=False)
        return TaskPipelineCommitResult(
            retry_contexts=tuple(retry_contexts),
            failed=failed,
            stopped=stopped,
        )

    def stop_engine_after_error(self, e: Exception) -> None:
        """框架级异常统一走同一收口，避免每个回调都重复停机逻辑。"""
        LogManager.get().error(Localizer.get().task_failed, e)
        Engine.get().set_status(Base.TaskStatus.STOPPING)

    def on_producer_error(self, e: Exception) -> None:
        """生产阶段异常说明调度已失真，这里直接停机。"""
        self.stop_engine_after_error(e)

    def on_worker_error(self, context: AnalysisTaskContext, e: Exception) -> None:
        """worker 未预期异常统一进入停止态，避免提交顺序失控。"""
        del context
        self.stop_engine_after_error(e)

    def on_commit_error(
        self,
        payloads: tuple[AnalysisCommitPayload, ...],
        e: Exception,
    ) -> None:
        """提交阶段异常会影响一致性，这里直接切到停止态。"""
        del payloads
        self.stop_engine_after_error(e)

    def on_worker_loop_error(self, e: Exception) -> None:
        """worker 主循环异常属于框架级故障，必须立刻停机。"""
        self.stop_engine_after_error(e)
