import asyncio
import concurrent.futures
import os
import threading
from typing import TYPE_CHECKING
from typing import Any

from rich.progress import TaskID

from base.Base import Base
from base.LogManager import LogManager
from module.Engine.Engine import Engine
from module.Engine.TaskLimiter import AsyncTaskLimiter
from module.Engine.TaskRequester import TaskRequester
from module.Localizer.Localizer import Localizer
from module.ProgressBar import ProgressBar

if TYPE_CHECKING:
    from module.Engine.Translator.Translator import Translator


class TranslatorTaskAsyncPipeline:
    """异步翻译调度管线（Pipeline/Coordinator）。

    将翻译调度的生产者/消费者/提交者拆分为独立协作对象，降低 Translator.start_async_translation
    的方法复杂度。
    """

    def __init__(
        self,
        *,
        translator: "Translator",
        progress: ProgressBar,
        pid: TaskID,
        task_limiter: AsyncTaskLimiter,
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
        self.high_queue: asyncio.Queue = asyncio.Queue(maxsize=self.buffer_size)
        self.commit_queue: asyncio.Queue = asyncio.Queue(maxsize=self.buffer_size)
        self.producer_done = asyncio.Event()

        # CPU 工作线程数：用于执行文本预处理、响应解析等 CPU 密集型操作
        self.cpu_workers = max(4, min(32, os.cpu_count() or 8))
        # in-flight 限制：控制同时处于"已创建但未完成"状态的协程数量
        self.in_flight_limit = max_workers + self.buffer_size

        self.clients_closed_on_stop = False
        self.commit_task: asyncio.Task | None = None

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

                future = asyncio.run_coroutine_threadsafe(
                    self.normal_queue.put(context), self.loop
                )

                while True:
                    if self.should_stop():
                        future.cancel()
                        break

                    try:
                        future.result(timeout=0.1)
                        break
                    except concurrent.futures.TimeoutError:
                        continue
                    except Exception as e:
                        # 事件循环已关闭/队列入队失败均无法继续生产。
                        LogManager.get().error(Localizer.get().task_failed, e)
                        Engine.get().set_status(Base.TaskStatus.STOPPING)
                        break
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            Engine.get().set_status(Base.TaskStatus.STOPPING)
        finally:
            try:
                self.loop.call_soon_threadsafe(self.producer_done.set)
            except Exception:
                pass

    def prune_done_in_flight(self, in_flight: set[asyncio.Task]) -> None:
        if not in_flight:
            return

        done = {t for t in in_flight if t.done()}
        if not done:
            return

        self.handle_done_tasks(done)
        in_flight.difference_update(done)

    def handle_done_tasks(self, done_tasks: set[asyncio.Task]) -> None:
        """显式读取异常，避免 "Task exception was never retrieved"。"""
        for task in done_tasks:
            try:
                exc = task.exception()
            except asyncio.CancelledError:
                continue
            except Exception as e:
                LogManager.get().error(
                    Localizer.get().task_failed,
                    e,
                )
                continue

            if exc is None:
                continue

            LogManager.get().error(
                Localizer.get().task_failed,
                exc,
            )
            Engine.get().set_status(Base.TaskStatus.STOPPING)

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

                extras_snapshot = await self.loop.run_in_executor(
                    db_executor,
                    self.translator.apply_batch_update_sync,
                    task,
                    result,
                    finalized_items,
                    processed_count,
                    error_count,
                    glossaries,
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
                with self.translator.db_lock:
                    self.translator.active_task_count -= 1

    async def get_next_context(self) -> Any | None:
        """优先级：high_queue > normal_queue。"""
        try:
            return self.high_queue.get_nowait()
        except asyncio.QueueEmpty:
            pass

        if (
            self.producer_done.is_set()
            and self.normal_queue.empty()
            and self.high_queue.empty()
        ):
            return None

        try:
            return await asyncio.wait_for(self.normal_queue.get(), timeout=0.1)
        except asyncio.TimeoutError:
            return None

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

        incremented = False
        submitted = False
        try:
            waited = await self.task_limiter.wait(self.should_stop)
            if not waited:
                return

            if self.should_stop():
                return

            task = self.translator.scheduler.create_task(context)

            with self.translator.db_lock:
                self.translator.active_task_count += 1
                incremented = True

            result = await task.start_async(cpu_executor)
            await self.commit_queue.put((context, task, result))
            submitted = True
        except Exception as e:
            LogManager.get().error(
                Localizer.get().task_failed,
                e,
            )
            Engine.get().set_status(Base.TaskStatus.STOPPING)
        finally:
            # 若提交队列失败或异常中断，避免活跃任务计数泄漏。
            if incremented and not submitted:
                with self.translator.db_lock:
                    self.translator.active_task_count -= 1

            self.task_limiter.release()

    async def close_clients_once_on_stop(self) -> None:
        if self.clients_closed_on_stop:
            return

        self.clients_closed_on_stop = True
        await TaskRequester.aclose_clients_for_running_loop()

    async def wait_for_any_in_flight(
        self,
        in_flight: set[asyncio.Task],
        *,
        timeout: float | None,
    ) -> None:
        if not in_flight:
            return

        # asyncio.wait() -> (done, pending)，这里仅关心 done。
        done = (
            await asyncio.wait(
                in_flight,
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )
        )[0]
        if not done:
            return

        self.handle_done_tasks(done)
        in_flight.difference_update(done)

    async def wait_for_all_in_flight(self, in_flight: set[asyncio.Task]) -> None:
        if not in_flight:
            return

        # asyncio.wait() -> (done, pending)，这里会等待直到全部 done。
        done = (await asyncio.wait(in_flight))[0]
        self.handle_done_tasks(done)
        in_flight.clear()

    async def run(self) -> None:
        self.start_producer_thread()

        in_flight: set[asyncio.Task] = set()
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
                self.commit_task = asyncio.create_task(self.committer(db_executor))

                while True:
                    self.prune_done_in_flight(in_flight)

                    if self.should_stop():
                        await self.close_clients_once_on_stop()
                        if not in_flight:
                            break
                        await self.wait_for_any_in_flight(in_flight, timeout=0.1)
                        continue

                    if (
                        self.producer_done.is_set()
                        and self.normal_queue.empty()
                        and self.high_queue.empty()
                        and not in_flight
                    ):
                        break

                    if len(in_flight) >= self.in_flight_limit:
                        await self.wait_for_any_in_flight(in_flight, timeout=None)
                        continue

                    context = await self.get_next_context()
                    if context is None:
                        await self.wait_for_any_in_flight(in_flight, timeout=0.1)
                        continue

                    task = asyncio.create_task(
                        self.run_one_context(context, cpu_executor)
                    )
                    in_flight.add(task)

                await self.wait_for_all_in_flight(in_flight)
                await self.commit_queue.put(None)
                if self.commit_task is not None:
                    await self.commit_task
        finally:
            # 退出时确保资源被关闭，避免 stop 后仍残留连接。
            await TaskRequester.aclose_clients_for_running_loop()

            if self.commit_task is not None and not self.commit_task.done():
                self.commit_task.cancel()
                try:
                    await self.commit_task
                except Exception:
                    pass
