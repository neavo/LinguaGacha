from enum import StrEnum


class EventTopic(StrEnum):
    """统一维护对外暴露的 SSE topic。"""

    PROJECT_CHANGED = "project.changed"
    TASK_STATUS_CHANGED = "task.status_changed"
    TASK_PROGRESS_CHANGED = "task.progress_changed"
    WORKBENCH_SNAPSHOT_CHANGED = "workbench.snapshot_changed"
    SETTINGS_CHANGED = "settings.changed"
