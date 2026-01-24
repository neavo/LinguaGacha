from datetime import datetime
from types import TracebackType
from typing import Any
from typing import Self

from rich.progress import BarColumn
from rich.progress import Progress
from rich.progress import TaskID
from rich.progress import TextColumn
from rich.progress import TimeElapsedColumn
from rich.progress import TimeRemainingColumn


class ProgressBar:
    # 类变量
    progress: Progress | None = None

    def __init__(self, transient: bool) -> None:
        super().__init__()

        # 初始化
        self.tasks: dict[TaskID, dict[str, Any]] = {}
        self.transient: bool = transient

    def __enter__(self) -> Self:
        if not isinstance(__class__.progress, Progress):
            __class__.progress = Progress(
                TextColumn(datetime.now().strftime("[%H:%M:%S]"), style="log.time"),
                TextColumn("INFO    ", style="logging.level.info"),
                BarColumn(bar_width=None),
                "•",
                TextColumn("{task.completed}/{task.total}", justify="right"),
                "•",
                TimeElapsedColumn(),
                "/",
                TimeRemainingColumn(),
                transient=self.transient,
            )
            __class__.progress.start()

        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        progress = __class__.progress
        if progress is None:
            return

        for id, attr in self.tasks.items():
            attr["running"] = False
            progress.stop_task(id)
            if self.transient:
                progress.remove_task(id)

        task_ids: set[TaskID] = {
            k for k, v in self.tasks.items() if not v.get("running")
        }
        if all(v in task_ids for v in progress.task_ids):
            progress.stop()
            __class__.progress = None

    def new(self, total: int | None = None, completed: int = 0) -> TaskID:
        progress = __class__.progress
        if progress is None:
            raise RuntimeError("Progress is not started")

        id = progress.add_task("", total=total, completed=completed)
        self.tasks[id] = {
            "running": True,
        }
        return id

    def update(
        self,
        id: TaskID,
        *,
        total: int | None = None,
        advance: int | None = None,
        completed: int | None = None,
    ) -> None:
        progress = __class__.progress
        if progress is not None:
            progress.update(id, total=total, advance=advance, completed=completed)
