import asyncio
import pathlib
import sys
import time

repo_root_path = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root_path))


def import_project_deps():
    from base.Base import Base
    from module.Engine.Engine import Engine
    from module.Engine.TaskLimiter import TaskLimiter
    from module.Engine.Translator.TranslatorTaskPipeline import TranslatorTaskPipeline

    return Base, Engine, TaskLimiter, TranslatorTaskPipeline


Base, Engine, TaskLimiter, TranslatorTaskPipeline = import_project_deps()


class FakeItem:
    def __init__(self) -> None:
        self.status = Base.ProjectStatus.NONE

    def get_status(self):
        return self.status

    def set_status(self, status) -> None:
        self.status = status

    def to_dict(self) -> dict:
        return {"status": self.status.value}


class FakeTask:
    def __init__(self, items: list[FakeItem]) -> None:
        self.items = items

    async def start_async(self, cpu_executor) -> dict:
        await asyncio.sleep(0.02)
        for item in self.items:
            item.set_status(Base.ProjectStatus.PROCESSED)

        return {
            "row_count": len(self.items),
            "input_tokens": 1,
            "output_tokens": 1,
            "glossaries": [],
        }


class FakeScheduler:
    def __init__(self, *, total_contexts: int, items_per_context: int) -> None:
        self.total_contexts = total_contexts
        self.items_per_context = items_per_context

    def generate_initial_contexts_iter(self):
        for i in range(self.total_contexts):
            yield i

    def handle_failed_context(self, context, result: dict):
        return []

    def create_task(self, context) -> FakeTask:
        items = [FakeItem() for _ in range(self.items_per_context)]
        return FakeTask(items)


class FakeProgress:
    def update(self, pid, *, completed: int, total: int) -> None:
        return


class FakeTranslator:
    def __init__(self, *, total_line: int, scheduler: FakeScheduler) -> None:
        self.scheduler = scheduler
        self.extras = {
            "start_time": time.time(),
            "total_line": total_line,
            "line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "time": 0,
        }

    def get_task_buffer_size(self, max_workers: int) -> int:
        return 8

    def update_extras_snapshot(
        self,
        *,
        processed_count: int,
        error_count: int,
        input_tokens: int,
        output_tokens: int,
    ) -> dict:
        self.extras["processed_line"] += processed_count
        self.extras["error_line"] += error_count
        self.extras["line"] = self.extras["processed_line"] + self.extras["error_line"]
        self.extras["total_tokens"] += input_tokens + output_tokens
        self.extras["total_input_tokens"] += input_tokens
        self.extras["total_output_tokens"] += output_tokens
        self.extras["time"] = time.time() - self.extras.get("start_time", 0)
        return dict(self.extras)

    def apply_batch_update_sync(
        self,
        finalized_items: list[dict],
        glossaries: list[dict],
        extras_snapshot: dict,
    ) -> None:
        if not isinstance(extras_snapshot, dict):
            raise TypeError("extras_snapshot 必须是 dict")
        if not isinstance(finalized_items, list):
            raise TypeError("finalized_items 必须是 list")
        return

    def emit(self, event, data: dict) -> None:
        return


async def run_verify() -> None:
    Engine.get().set_status(Base.TaskStatus.TRANSLATING)
    try:
        total_contexts = 40
        items_per_context = 1
        total_line = total_contexts * items_per_context

        limiter = TaskLimiter(rps=0, rpm=0, max_concurrency=3)
        scheduler = FakeScheduler(
            total_contexts=total_contexts, items_per_context=items_per_context
        )
        translator = FakeTranslator(total_line=total_line, scheduler=scheduler)
        progress = FakeProgress()

        pipeline = TranslatorTaskPipeline(
            translator=translator,
            progress=progress,
            pid=0,
            task_limiter=limiter,
            max_workers=5,
        )

        done = asyncio.Event()
        max_seen = 0

        async def monitor() -> None:
            nonlocal max_seen
            while not done.is_set():
                max_seen = max(max_seen, limiter.get_concurrency_in_use())
                await asyncio.sleep(0.001)

        monitor_task = asyncio.create_task(monitor())
        await pipeline.run()
        done.set()
        await monitor_task

        if max_seen > 3:
            raise AssertionError(f"并发上限失效：max_seen={max_seen} > 3")

        if translator.extras.get("line") != total_line:
            raise AssertionError(
                f"进度统计异常：line={translator.extras.get('line')} expected={total_line}"
            )
    finally:
        Engine.get().set_status(Base.TaskStatus.IDLE)


def main() -> None:
    asyncio.run(run_verify())
    print("verify_async_pipeline: OK")


if __name__ == "__main__":
    main()
