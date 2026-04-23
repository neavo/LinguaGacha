from __future__ import annotations

from base.Base import Base


class TaskModeStrategy:
    """统一分析与翻译共享的任务模式状态规则。"""

    CONTINUE_PENDING_STATUSES: tuple[Base.ProjectStatus, ...] = (
        Base.ProjectStatus.NONE,
    )

    @classmethod
    def should_schedule_continue(
        cls,
        status: Base.ProjectStatus | None,
    ) -> bool:
        """继续任务时只重新调度仍处于 NONE 的条目。"""

        return status is None or status in cls.CONTINUE_PENDING_STATUSES
