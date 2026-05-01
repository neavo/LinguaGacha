import pytest

from base.Base import Base
from module.Engine.TaskModeStrategy import TaskModeStrategy


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (None, True),
        (Base.ItemStatus.NONE, True),
        (Base.ItemStatus.PROCESSED, False),
        (Base.ItemStatus.ERROR, False),
    ],
)
def test_should_schedule_continue_only_accepts_pending_status(
    status: Base.ItemStatus | None, expected: bool
) -> None:
    assert TaskModeStrategy.should_schedule_continue(status) is expected
