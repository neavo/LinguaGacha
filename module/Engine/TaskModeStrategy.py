from __future__ import annotations

from base.Base import Base


class TaskModeStrategy:
    """统一分析与翻译共享的任务模式状态规则。"""

    CONTINUE_PENDING_STATUSES: tuple[Base.ProjectStatus, ...] = (
        Base.ProjectStatus.NONE,
    )
    FAILED_STATUSES: tuple[Base.ProjectStatus, ...] = (Base.ProjectStatus.ERROR,)
    TRACKED_PROGRESS_STATUSES: tuple[Base.ProjectStatus, ...] = (
        Base.ProjectStatus.NONE,
        Base.ProjectStatus.PROCESSED,
        Base.ProjectStatus.ERROR,
    )

    @classmethod
    def should_schedule_continue(
        cls,
        status: Base.ProjectStatus | None,
    ) -> bool:
        """继续任务时只重新调度仍处于 NONE 的条目。"""

        return status is None or status in cls.CONTINUE_PENDING_STATUSES

    @classmethod
    def should_reset_failed(
        cls,
        status: Base.ProjectStatus | None,
    ) -> bool:
        """失败回收只认 ERROR，避免误伤已完成条目。"""

        return status in cls.FAILED_STATUSES

    @classmethod
    def is_tracked_progress_status(
        cls,
        status: Base.ProjectStatus | None,
    ) -> bool:
        """统一定义哪些状态属于任务模式语义里的可统计范围。"""

        return status in cls.TRACKED_PROGRESS_STATUSES
