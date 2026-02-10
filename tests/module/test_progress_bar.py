from collections.abc import Generator

import pytest
from rich.progress import TaskID

from module.ProgressBar import ProgressBar


class FakeProgress:
    def __init__(self, *args, **kwargs) -> None:
        del args, kwargs
        self.started = False
        self.stopped = False
        self.task_ids: list[int] = []
        self.operations: list[tuple] = []

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True

    def add_task(self, *args, total=None, completed=0):
        del args
        task_id = len(self.task_ids) + 1
        self.task_ids.append(task_id)
        self.operations.append(("add", task_id, total, completed))
        return task_id

    def update(self, task_id: int, **kwargs) -> None:
        self.operations.append(("update", task_id, kwargs))

    def stop_task(self, task_id: int) -> None:
        self.operations.append(("stop_task", task_id))

    def remove_task(self, task_id: int) -> None:
        self.task_ids = [v for v in self.task_ids if v != task_id]
        self.operations.append(("remove_task", task_id))


@pytest.fixture(autouse=True)
def reset_progress_state() -> Generator[None, None, None]:
    ProgressBar.progress = None
    yield
    ProgressBar.progress = None


class TestProgressBar:
    def test_context_manager_starts_and_stops_progress(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("module.ProgressBar.Progress", FakeProgress)

        with ProgressBar(transient=True) as bar:
            task_id = bar.new(total=3)
            bar.update(task_id, advance=1)

            fake = ProgressBar.progress
            assert isinstance(fake, FakeProgress)
            assert fake.started is True

        assert fake.stopped is True
        assert ProgressBar.progress is None

    def test_new_raises_when_progress_not_started(self) -> None:
        bar = ProgressBar(transient=False)
        with pytest.raises(RuntimeError, match="Progress is not started"):
            bar.new(total=1)

    def test_update_is_noop_when_progress_not_started(self) -> None:
        bar = ProgressBar(transient=False)
        bar.update(TaskID(1), advance=1)
