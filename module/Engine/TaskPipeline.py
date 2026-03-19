from __future__ import annotations

import concurrent.futures
import queue
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Generic
from typing import Protocol
from typing import TypeVar


ContextT = TypeVar("ContextT")
CommitPayloadT = TypeVar("CommitPayloadT")


@dataclass(frozen=True)
class TaskPipelineCommitResult(Generic[ContextT]):
    """提交阶段对调度骨架返回的控制结果。"""

    retry_contexts: tuple[ContextT, ...] = tuple()
    failed: bool = False
    stopped: bool = False


@dataclass(frozen=True)
class TaskPipelineRunResult:
    """流水线执行完成后的最小观测结果。"""

    stopped: bool
    failed: bool
    committed_payload_count: int
    commit_queue_peak_length: int


class TaskPipelineHooks(Protocol[ContextT, CommitPayloadT]):
    """把领域差异收成 hooks，通用骨架只负责调度。"""

    def should_stop(self) -> bool: ...

    def get_producer_thread_name(self) -> str: ...

    def get_worker_thread_name_prefix(self) -> str: ...

    def iter_initial_contexts(self) -> Iterator[ContextT]: ...

    def run_context(self, context: ContextT) -> CommitPayloadT | None: ...

    def handle_commit_payload(
        self,
        payload: CommitPayloadT,
    ) -> TaskPipelineCommitResult[ContextT]: ...

    def on_producer_error(self, e: Exception) -> None: ...

    def on_worker_error(self, context: ContextT, e: Exception) -> None: ...

    def on_commit_error(self, payload: CommitPayloadT, e: Exception) -> None: ...

    def on_worker_loop_error(self, e: Exception) -> None: ...


class TaskPipeline(Generic[ContextT, CommitPayloadT]):
    """统一处理初始生产、优先队列调度、worker pool 和 commit loop。"""

    def __init__(
        self,
        *,
        hooks: TaskPipelineHooks[ContextT, CommitPayloadT],
        max_workers: int,
        normal_queue_size: int,
        high_queue_size: int,
        commit_queue_size: int,
    ) -> None:
        self.hooks = hooks
        self.max_workers = max(1, max_workers)

        self.normal_queue: queue.Queue[ContextT] = queue.Queue(
            maxsize=max(1, normal_queue_size)
        )
        self.high_queue: queue.Queue[ContextT] = queue.Queue(
            maxsize=max(1, high_queue_size)
        )
        self.commit_queue: queue.Queue[CommitPayloadT] = queue.Queue(
            maxsize=max(1, commit_queue_size)
        )

        self.producer_done = threading.Event()

        # active_context_count 统计“已取出但尚未完成”的上下文数量，
        # 避免 commit loop 在 worker 尚未产出任何结果时提前退出。
        self.active_context_count = 0
        self.active_context_lock = threading.Lock()

        # pending_commit_count 统计“已完成执行但尚未提交”的载荷数量，
        # 避免 worker 在 committer 还没生成重试任务时误判可退出。
        self.pending_commit_count = 0
        self.pending_commit_lock = threading.Lock()

        self.commit_queue_peak_length = 0

    def start_producer_thread(self) -> None:
        """后台线程流式生产初始上下文，避免一次性塞满内存。"""
        threading.Thread(
            target=self.producer,
            name=self.hooks.get_producer_thread_name(),
            daemon=True,
        ).start()

    def producer(self) -> None:
        """把 hooks 生成的初始上下文持续送入普通队列。"""
        try:
            for context in self.hooks.iter_initial_contexts():
                if self.hooks.should_stop():
                    break

                while True:
                    if self.hooks.should_stop():
                        break
                    try:
                        self.normal_queue.put(context, timeout=0.1)
                        break
                    except queue.Full:
                        continue
        except Exception as e:
            self.hooks.on_producer_error(e)
        finally:
            self.producer_done.set()

    def get_pending_commit_count(self) -> int:
        with self.pending_commit_lock:
            return self.pending_commit_count

    def get_active_context_count(self) -> int:
        with self.active_context_lock:
            return self.active_context_count

    def inc_active_context(self) -> None:
        with self.active_context_lock:
            self.active_context_count += 1

    def dec_active_context(self) -> None:
        with self.active_context_lock:
            if self.active_context_count > 0:
                self.active_context_count -= 1

    def inc_pending_commit(self) -> None:
        with self.pending_commit_lock:
            self.pending_commit_count += 1

    def dec_pending_commit(self) -> None:
        with self.pending_commit_lock:
            if self.pending_commit_count > 0:
                self.pending_commit_count -= 1

    def has_pending_contexts(self) -> bool:
        """统一判断是否还有待执行上下文。"""
        return not self.normal_queue.empty() or not self.high_queue.empty()

    def can_stop_dispatch(self) -> bool:
        """生产结束且没有待提交结果时，worker 才能安全停下。"""
        return (
            self.producer_done.is_set()
            and not self.has_pending_contexts()
            and self.get_pending_commit_count() == 0
        )

    def can_stop_commit_loop(self) -> bool:
        """提交循环只在待执行、在途、待提交都清空后退出。"""
        return self.can_stop_dispatch() and self.get_active_context_count() == 0

    def get_next_context(self) -> ContextT | None:
        """优先取高优队列，再回普通队列。"""
        while True:
            if self.hooks.should_stop():
                return None

            try:
                return self.high_queue.get_nowait()
            except queue.Empty:
                pass

            if self.can_stop_dispatch():
                return None

            try:
                return self.normal_queue.get(timeout=0.1)
            except queue.Empty:
                continue

    def record_commit_queue_peak(self) -> None:
        """记录提交队列峰值，便于观测提交侧是否堆积。"""
        self.commit_queue_peak_length = max(
            self.commit_queue_peak_length,
            self.commit_queue.qsize(),
        )

    def enqueue_commit_payload(self, payload: CommitPayloadT) -> None:
        """worker 完成后统一把提交载荷交给 commit loop。"""
        self.inc_pending_commit()
        queued = False
        try:
            self.commit_queue.put(payload)
            queued = True
            self.record_commit_queue_peak()
        finally:
            if not queued:
                self.dec_pending_commit()

    def run_one_context(self, context: ContextT) -> None:
        """执行单个上下文，并把结果转给提交队列。"""
        if self.hooks.should_stop():
            return

        try:
            payload = self.hooks.run_context(context)
            if payload is None:
                return
            self.enqueue_commit_payload(payload)
        except Exception as e:
            self.hooks.on_worker_error(context, e)

    def worker(self) -> None:
        """固定 worker 线程：持续取上下文执行。"""
        while True:
            if self.hooks.should_stop():
                return

            context = self.get_next_context()
            if context is None:
                return

            self.inc_active_context()
            try:
                self.run_one_context(context)
            finally:
                self.dec_active_context()

    def enqueue_retry_contexts(self, retry_contexts: tuple[ContextT, ...]) -> None:
        """重试与拆分任务统一走高优队列，确保优先补位。"""
        for context in retry_contexts:
            while True:
                if self.hooks.should_stop():
                    return
                try:
                    self.high_queue.put(context, timeout=0.1)
                    break
                except queue.Full:
                    continue

    def build_run_result(
        self,
        *,
        stopped: bool,
        failed: bool,
        committed_payload_count: int,
    ) -> TaskPipelineRunResult:
        """统一封装最终运行结果，避免退出分支口径漂移。"""
        return TaskPipelineRunResult(
            stopped=stopped or self.hooks.should_stop(),
            failed=failed,
            committed_payload_count=committed_payload_count,
            commit_queue_peak_length=self.commit_queue_peak_length,
        )

    def commit_loop(self) -> TaskPipelineRunResult:
        """串行提交 worker 结果，并负责生成重试任务。"""
        committed_payload_count = 0
        failed = False
        stopped = False

        while True:
            if self.hooks.should_stop():
                self.drain_context_queues_on_stop()

            try:
                payload = self.commit_queue.get(timeout=0.1)
            except queue.Empty:
                if self.can_stop_commit_loop():
                    return self.build_run_result(
                        stopped=stopped,
                        failed=failed,
                        committed_payload_count=committed_payload_count,
                    )

                if self.hooks.should_stop():
                    if (
                        self.commit_queue.empty()
                        and self.get_pending_commit_count() == 0
                        and self.get_active_context_count() == 0
                    ):
                        return self.build_run_result(
                            stopped=True,
                            failed=failed,
                            committed_payload_count=committed_payload_count,
                        )
                continue

            try:
                commit_result = self.hooks.handle_commit_payload(payload)
                committed_payload_count += 1
                failed = failed or commit_result.failed
                stopped = stopped or commit_result.stopped
                self.enqueue_retry_contexts(commit_result.retry_contexts)
            except Exception as e:
                failed = True
                self.hooks.on_commit_error(payload, e)
            finally:
                self.dec_pending_commit()

    def drain_context_queues_on_stop(self) -> None:
        """停止时丢弃尚未执行的上下文，避免 commit loop 被队列卡住。"""
        while True:
            try:
                self.high_queue.get_nowait()
            except queue.Empty:
                break

        while True:
            try:
                self.normal_queue.get_nowait()
            except queue.Empty:
                break

    def run(self) -> TaskPipelineRunResult:
        """启动完整流水线并等待 worker/committer 收尾。"""
        self.start_producer_thread()

        run_result = self.build_run_result(
            stopped=False,
            failed=False,
            committed_payload_count=0,
        )
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=self.max_workers,
            thread_name_prefix=self.hooks.get_worker_thread_name_prefix(),
        ) as executor:
            futures = [executor.submit(self.worker) for _ in range(self.max_workers)]
            run_result = self.commit_loop()
            for future in futures:
                try:
                    future.result()
                except Exception as e:
                    self.hooks.on_worker_loop_error(e)
                    run_result = TaskPipelineRunResult(
                        stopped=run_result.stopped or self.hooks.should_stop(),
                        failed=True,
                        committed_payload_count=run_result.committed_payload_count,
                        commit_queue_peak_length=run_result.commit_queue_peak_length,
                    )
        return run_result
