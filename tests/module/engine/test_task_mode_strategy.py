import pytest

from base.Base import Base
from module.Engine.TaskModeStrategy import TaskModeStrategy


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (None, True),
        (Base.ProjectStatus.NONE, True),
        (Base.ProjectStatus.PROCESSED, False),
        (Base.ProjectStatus.ERROR, False),
    ],
)
def test_should_schedule_continue_only_accepts_pending_status(
    status: Base.ProjectStatus | None, expected: bool
) -> None:
    assert TaskModeStrategy.should_schedule_continue(status) is expected


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (None, False),
        (Base.ProjectStatus.NONE, False),
        (Base.ProjectStatus.PROCESSED, False),
        (Base.ProjectStatus.ERROR, True),
    ],
)
def test_should_reset_failed_only_accepts_error_status(
    status: Base.ProjectStatus | None, expected: bool
) -> None:
    assert TaskModeStrategy.should_reset_failed(status) is expected


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (None, False),
        (Base.ProjectStatus.NONE, True),
        (Base.ProjectStatus.PROCESSING, False),
        (Base.ProjectStatus.PROCESSED, True),
        (Base.ProjectStatus.ERROR, True),
    ],
)
def test_is_tracked_progress_status_matches_shared_statistics_contract(
    status: Base.ProjectStatus | None, expected: bool
) -> None:
    assert TaskModeStrategy.is_tracked_progress_status(status) is expected
