from __future__ import annotations

import concurrent.futures
import queue
import threading
from typing import TYPE_CHECKING

from rich.progress import TaskID

from base.Base import Base
from base.LogManager import LogManager
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar

if TYPE_CHECKING:
    from module.Engine.TaskScheduler import TaskContext
    from module.Engine.Translator.Translator import Translator
    from module.Engine.Translator.TranslatorTask import TranslatorTask


class TranslatorTaskPipeline:
    """同步翻译调度管线（Pipeline/Coordinator）。

    结构：
    - Producer(Thread): 流式生成 TaskContext，入 normal_queue
    - WorkerPool(N Threads): 执行 TaskContext -> (context, task, result)，入 commit_queue
    - Commit Loop(当前线程): 串行落库、更新进度、生成重试/拆分任务入 high_queue
    """

    HIGH_QUEUE_MAX: int = 16384
    HIGH_QUEUE_MULTIPLIER: int = 8

    def __init__(
        self,
        *,
        translator: "Translator",
        progress: ProgressBar,
        pid: TaskID,
        task_limiter: TaskLimiter,
        max_workers: int,
    ) -> None:
        self.translator = translator
        self.progress = progress
        self.pid = pid
        self.task_limiter = task_limiter
        self.max_workers = max_workers

        self.buffer_size = self.translator.get_task_buffer_size(max_workers)
        self.normal_queue: queue.Queue[TaskContext] = queue.Queue(
            maxsize=self.buffer_size
        )

        high_queue_size = min(
            __class__.HIGH_QUEUE_MAX,
            self.buffer_size * __class__.HIGH_QUEUE_MULTIPLIER,
        )
        self.high_queue: queue.Queue[TaskContext] = queue.Queue(maxsize=high_queue_size)
        self.commit_queue: queue.Queue[tuple[TaskContext, TranslatorTask, dict]] = (
            queue.Queue(maxsize=self.buffer_size)
        )

        self.producer_done = threading.Event()

        # active_context_count 统计“已取出但尚未完成”的上下文数量。
        # 若不跟踪该值，commit_loop 可能在“任务已全部分发但尚未产出任何结果”的窗口期
        # 误判为已完成，从而提前退出，导致后续结果无人消费/重试任务无人执行。
        self.active_context_count = 0
        self.active_context_lock = threading.Lock()

        # pending_commit_count 用于避免 worker 在“最后一个结果提交后、
        # committer 尚未生成重试/拆分任务”窗口期提前退出。
        self.pending_commit_count = 0
        self.pending_commit_lock = threading.Lock()

    def should_stop(self) -> bool:
        return Engine.get().get_status() == Base.TaskStatus.STOPPING

    def start_producer_thread(self) -> None:
        threading.Thread(
            target=self.producer,
            name=f"{Engine.TASK_PREFIX}PRODUCER",
            daemon=True,
        ).start()

    def producer(self) -> None:
        """生产者线程：流式生成初始任务上下文并入队。"""
        try:
            for context in self.translator.scheduler.generate_initial_contexts_iter():
                if self.should_stop():
                    break

                while True:
                    if self.should_stop():
                        break
                    try:
                        self.normal_queue.put(context, timeout=0.1)
                        break
                    except queue.Full:
                        continue
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            Engine.get().set_status(Base.TaskStatus.STOPPING)
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

    def get_next_context(self) -> TaskContext | None:
        """优先级：high_queue > normal_queue。"""
        while True:
            if self.should_stop():
                return None

            try:
                return self.high_queue.get_nowait()
            except queue.Empty:
                pass

            if (
                self.producer_done.is_set()
                and self.normal_queue.empty()
                and self.high_queue.empty()
                and self.get_pending_commit_count() == 0
            ):
                return None

            try:
                return self.normal_queue.get(timeout=0.1)
            except queue.Empty:
                continue

    def run_one_context(self, context: TaskContext) -> None:
        if self.should_stop():
            return

        acquired = self.task_limiter.acquire(self.should_stop)
        if not acquired:
            return

        try:
            waited = self.task_limiter.wait(self.should_stop)
            if not waited:
                return

            if self.should_stop():
                return

            task = self.translator.scheduler.create_task(context)
            result = task.start()

            # 先增计数再 put，避免 committer 抢先消费导致计数错位。
            self.inc_pending_commit()
            queued = False
            try:
                self.commit_queue.put((context, task, result))
                queued = True
            finally:
                if not queued:
                    self.dec_pending_commit()
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            Engine.get().set_status(Base.TaskStatus.STOPPING)
        finally:
            self.task_limiter.release()

    def worker(self) -> None:
        """固定 worker 线程：持续消费上下文并执行翻译。"""
        while True:
            if self.should_stop():
                return

            context = self.get_next_context()
            if context is None:
                return

            self.inc_active_context()
            try:
                self.run_one_context(context)
            finally:
                self.dec_active_context()

    def commit_loop(self) -> None:
        while True:
            if self.should_stop():
                # 停止时丢弃未执行的上下文，避免 commit_loop 因队列非空而无法退出。
                self.drain_context_queues_on_stop()

            try:
                payload = self.commit_queue.get(timeout=0.1)
            except queue.Empty:
                # 任务未完成时，commit_queue 可能在一段时间内为空（尤其是高并发+长请求）。
                # 此时必须保持 commit_loop 存活，等待 worker 产出结果。
                if (
                    self.producer_done.is_set()
                    and self.normal_queue.empty()
                    and self.high_queue.empty()
                    and self.get_pending_commit_count() == 0
                    and self.get_active_context_count() == 0
                ):
                    return

                if self.should_stop():
                    # 同步流式下 stop 可能需要等待 SDK 超时/收尾；这里仅等待已产出的结果落库。
                    if (
                        self.commit_queue.empty()
                        and self.get_pending_commit_count() == 0
                        and self.get_active_context_count() == 0
                    ):
                        return
                    continue
                continue

            context, task, result = payload
            try:
                if not self.should_stop() and any(
                    i.get_status() == Base.ProjectStatus.NONE for i in task.items
                ):
                    for new_context in self.translator.scheduler.handle_failed_context(
                        context, result
                    ):
                        while True:
                            if self.should_stop():
                                break
                            try:
                                self.high_queue.put(new_context, timeout=0.1)
                                break
                            except queue.Full:
                                continue

                finalized_items = [
                    item.to_dict()
                    for item in task.items
                    if item.get_status()
                    in (Base.ProjectStatus.PROCESSED, Base.ProjectStatus.ERROR)
                ]

                processed_count = sum(
                    1
                    for i in task.items
                    if i.get_status() == Base.ProjectStatus.PROCESSED
                )
                error_count = sum(
                    1 for i in task.items if i.get_status() == Base.ProjectStatus.ERROR
                )

                glossaries = result.get("glossaries")
                if not isinstance(glossaries, list):
                    glossaries = []

                input_tokens = int(result.get("input_tokens", 0) or 0)
                output_tokens = int(result.get("output_tokens", 0) or 0)
                extras_snapshot = self.translator.update_extras_snapshot(
                    processed_count=processed_count,
                    error_count=error_count,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )

                self.translator.apply_batch_update_sync(
                    finalized_items,
                    glossaries,
                    extras_snapshot,
                )

                self.progress.update(
                    self.pid,
                    completed=extras_snapshot.get("line", 0),
                    total=extras_snapshot.get("total_line", 0),
                )
                self.translator.emit(Base.Event.TRANSLATION_UPDATE, extras_snapshot)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                Engine.get().set_status(Base.TaskStatus.STOPPING)
            finally:
                self.dec_pending_commit()

    def drain_context_queues_on_stop(self) -> None:
        # 用非阻塞方式清空，避免 stop 后 worker 退出导致队列永远不空。
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

    def run(self) -> None:
        self.start_producer_thread()

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=self.max_workers,
            thread_name_prefix=f"{Engine.TASK_PREFIX}WORKER",
        ) as executor:
            futures = [executor.submit(self.worker) for _ in range(self.max_workers)]
            self.commit_loop()
            for f in futures:
                try:
                    f.result()
                except Exception as e:
                    LogManager.get().error(Localizer.get().task_failed, e)
                    Engine.get().set_status(Base.TaskStatus.STOPPING)
