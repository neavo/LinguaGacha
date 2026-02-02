import asyncio
import concurrent.futures
import os
import queue
import threading
from typing import TYPE_CHECKING
from typing import Any

from rich.progress import TaskID

from base.Base import Base
from base.LogManager import LogManager
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import TaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar

if TYPE_CHECKING:
    from module.Engine.Translator.Translator import Translator


class TranslatorTaskPipeline:
    """翻译调度管线（Pipeline/Coordinator）。

    将翻译调度的生产者/消费者/提交者拆分为独立协作对象，降低 Translator.start_async_translation
    的方法复杂度。
    """

    # 高优先级队列容量上限（防止极端情况下内存占用过大）
    HIGH_QUEUE_MAX: int = 16384
    # 高优先级队列相对于 buffer_size 的倍率（失败任务扇出需要额外余量）
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

        self.loop = asyncio.get_running_loop()

        self.buffer_size = self.translator.get_task_buffer_size(max_workers)
        self.normal_queue: asyncio.Queue = asyncio.Queue(maxsize=self.buffer_size)
        # 失败任务会扇出出更多重试/拆分任务；high_queue 需要更大的余量，否则极端失败场景下
        # committer 可能因队列满而阻塞，进而导致工作协程卡在 commit_queue.put 上。
        high_queue_size = min(
            __class__.HIGH_QUEUE_MAX,
            self.buffer_size * __class__.HIGH_QUEUE_MULTIPLIER,
        )
        self.high_queue: asyncio.Queue = asyncio.Queue(maxsize=high_queue_size)
        self.commit_queue: asyncio.Queue = asyncio.Queue(maxsize=self.buffer_size)
        self.producer_done = asyncio.Event()

        # 生产者运行在后台线程，通过同步队列做跨线程桥接。
        self.normal_queue_sync: queue.Queue[Any] = queue.Queue(maxsize=self.buffer_size)
        self.producer_done_sync = threading.Event()

        # CPU 工作线程数：用于执行文本预处理、响应解析等 CPU 密集型操作
        self.cpu_workers = max(4, min(32, os.cpu_count() or 8))

        self.clients_closed_on_stop = False
        self.commit_task: asyncio.Task | None = None
        self.pump_task: asyncio.Task | None = None

        self.close_clients_timeout_s = 2.0

        # pending_commit_count 用于避免 worker 在“最后一个 chunk 提交结果后、
        # committer 还未来得及生成重试/拆分任务”这一窗口期提前退出。
        # 典型症状：最后一条为多行文本时出现黄框(部分通过)后任务直接停止。
        self.pending_commit_count: int = 0

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
                        self.normal_queue_sync.put(context, timeout=0.1)
                        break
                    except queue.Full:
                        continue
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            Engine.get().set_status(Base.TaskStatus.STOPPING)
        finally:
            self.producer_done_sync.set()

    async def pump_normal_queue(self) -> None:
        """将同步队列中的上下文转发到 asyncio 队列。"""
        try:
            while True:
                if self.should_stop():
                    return

                try:
                    context = await asyncio.to_thread(
                        self.normal_queue_sync.get,
                        True,
                        0.1,
                    )
                except queue.Empty:
                    if self.producer_done_sync.is_set():
                        return
                    continue

                while True:
                    if self.should_stop():
                        return

                    try:
                        self.normal_queue.put_nowait(context)
                        break
                    except asyncio.QueueFull:
                        await asyncio.sleep(0.05)
        finally:
            self.producer_done.set()

    async def committer(self, db_executor: concurrent.futures.Executor) -> None:
        """提交协程：处理翻译结果、更新数据库、处理失败任务。"""
        while True:
            payload = await self.commit_queue.get()
            if payload is None:
                return

            context, task, result = payload

            try:
                if not self.should_stop() and any(
                    i.get_status() == Base.ProjectStatus.NONE for i in task.items
                ):
                    for new_context in self.translator.scheduler.handle_failed_context(
                        context, result
                    ):
                        await self.high_queue.put(new_context)

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

                await self.loop.run_in_executor(
                    db_executor,
                    self.translator.apply_batch_update_sync,
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
                LogManager.get().error(
                    Localizer.get().task_failed,
                    e,
                )
                Engine.get().set_status(Base.TaskStatus.STOPPING)
            finally:
                if self.pending_commit_count > 0:
                    self.pending_commit_count -= 1

    async def get_next_context(self) -> Any | None:
        """优先级：high_queue > normal_queue。"""
        while True:
            if self.should_stop():
                return None

            try:
                return self.high_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass

            # 退出条件必须考虑 committer 的“提交窗口期”：
            # worker 可能刚把最后一个 payload 放入 commit_queue，
            # committer 尚未处理并生成重试任务(high_queue 仍为空)。
            if (
                self.producer_done.is_set()
                and self.normal_queue.empty()
                and self.high_queue.empty()
                and self.pending_commit_count == 0
            ):
                return None

            try:
                return await asyncio.wait_for(self.normal_queue.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue

    async def run_one_context(
        self,
        context: Any,
        cpu_executor: concurrent.futures.Executor,
    ) -> None:
        """执行单个任务上下文的翻译流程。"""
        if self.should_stop():
            return

        acquired = await self.task_limiter.acquire(self.should_stop)
        if not acquired:
            return

        try:
            waited = await self.task_limiter.wait(self.should_stop)
            if not waited:
                return

            if self.should_stop():
                return

            task = self.translator.scheduler.create_task(context)
            result = await task.start_async(cpu_executor)
            # 先增计数再 await put，避免 committer 抢先消费导致计数错位。
            self.pending_commit_count += 1
            queued = False
            try:
                await self.commit_queue.put((context, task, result))
                queued = True
            finally:
                if not queued and self.pending_commit_count > 0:
                    self.pending_commit_count -= 1
        except Exception as e:
            LogManager.get().error(
                Localizer.get().task_failed,
                e,
            )
            Engine.get().set_status(Base.TaskStatus.STOPPING)
        finally:
            self.task_limiter.release()

    async def worker(self, cpu_executor: concurrent.futures.Executor) -> None:
        """固定 worker 协程：持续消费上下文并执行翻译。"""
        while True:
            if self.should_stop():
                await self.close_clients_once_on_stop()
                return

            context = await self.get_next_context()
            if context is None:
                return

            await self.run_one_context(context, cpu_executor)

    async def close_clients_once_on_stop(self) -> None:
        if self.clients_closed_on_stop:
            return

        self.clients_closed_on_stop = True
        try:
            await asyncio.wait_for(
                TaskRequester.aclose_clients_for_running_loop(),
                timeout=self.close_clients_timeout_s,
            )
        except asyncio.TimeoutError as e:
            LogManager.get().warning(Localizer.get().task_close_failed, e)

    async def run(self) -> None:
        self.start_producer_thread()

        try:
            with (
                concurrent.futures.ThreadPoolExecutor(
                    max_workers=self.cpu_workers,
                    thread_name_prefix=f"{Engine.TASK_PREFIX}CPU",
                ) as cpu_executor,
                concurrent.futures.ThreadPoolExecutor(
                    max_workers=1,
                    thread_name_prefix=f"{Engine.TASK_PREFIX}DB",
                ) as db_executor,
            ):
                self.pump_task = asyncio.create_task(self.pump_normal_queue())
                self.commit_task = asyncio.create_task(self.committer(db_executor))

                worker_tasks = [
                    asyncio.create_task(self.worker(cpu_executor))
                    for _ in range(self.max_workers)
                ]
                results = await asyncio.gather(*worker_tasks, return_exceptions=True)
                for result in results:
                    if not isinstance(result, Exception):
                        continue
                    LogManager.get().error(Localizer.get().task_failed, result)
                    Engine.get().set_status(Base.TaskStatus.STOPPING)

                await self.commit_queue.put(None)
                if self.commit_task is not None:
                    await self.commit_task

                if self.pump_task is not None:
                    await self.pump_task
        finally:
            # 退出时确保资源被关闭，避免 stop 后仍残留连接。
            try:
                await asyncio.wait_for(
                    TaskRequester.aclose_clients_for_running_loop(),
                    timeout=self.close_clients_timeout_s,
                )
            except asyncio.TimeoutError as e:
                LogManager.get().warning(Localizer.get().task_close_failed, e)

            if self.pump_task is not None and not self.pump_task.done():
                self.pump_task.cancel()
                try:
                    await self.pump_task
                except Exception:
                    pass

            if self.commit_task is not None and not self.commit_task.done():
                self.commit_task.cancel()
                try:
                    await self.commit_task
                except Exception:
                    pass
