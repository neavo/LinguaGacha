from enum import StrEnum


class EventTopic(StrEnum):
    """统一维护对外暴露的 SSE topic。"""

    PROJECT_CHANGED = "project.changed"
    TASK_STATUS_CHANGED = "task.status_changed"
    TASK_PROGRESS_CHANGED = "task.progress_changed"
    SETTINGS_CHANGED = "settings.changed"
    EXTRA_TS_CONVERSION_PROGRESS = "extra.ts_conversion_progress"
    EXTRA_TS_CONVERSION_FINISHED = "extra.ts_conversion_finished"
