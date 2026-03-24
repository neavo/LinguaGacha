import threading

from api.Bridge.EventTopic import EventTopic
from model.Api.ProjectModels import ProjectSnapshot
from model.Api.TaskModels import TaskProgressUpdate
from model.Api.TaskModels import TaskSnapshot
from model.Api.TaskModels import TaskStatusUpdate


class ApiStateStore:
    """维护 UI 当前真正需要的冻结快照对象。"""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.project_snapshot: ProjectSnapshot = ProjectSnapshot.from_dict({})
        self.task_snapshot: TaskSnapshot = TaskSnapshot.from_dict({})

    def hydrate_project(self, snapshot: ProjectSnapshot) -> None:
        """用服务端快照覆盖本地工程状态，保持单一缓存入口。"""

        with self.lock:
            self.project_snapshot = snapshot

    def reset_project(self) -> None:
        """工程关闭后恢复到未加载态，避免 UI 继续读到陈旧路径。"""

        with self.lock:
            self.project_snapshot = ProjectSnapshot.from_dict({})

    def is_project_loaded(self) -> bool:
        """给 UI 提供稳定布尔值，减少页面自己猜状态。"""

        with self.lock:
            return self.project_snapshot.loaded

    def get_project_path(self) -> str:
        """统一读取当前工程路径。"""

        with self.lock:
            return self.project_snapshot.path

    def get_project_snapshot(self) -> ProjectSnapshot:
        """返回工程快照对象，避免外部继续操作可变字典。"""

        with self.lock:
            return self.project_snapshot

    def hydrate_task(self, snapshot: TaskSnapshot) -> None:
        """用任务快照覆盖本地状态，供页面首屏 hydration 使用。"""

        with self.lock:
            self.task_snapshot = snapshot

    def merge_task_progress(self, update: TaskProgressUpdate) -> None:
        """SSE 进度增量只覆盖任务快照中的进度字段。"""

        with self.lock:
            self.task_snapshot = self.task_snapshot.merge_progress(update)

    def merge_task_status(self, update: TaskStatusUpdate) -> None:
        """SSE 状态增量只覆盖任务快照中的状态字段。"""

        with self.lock:
            self.task_snapshot = self.task_snapshot.merge_status(update)

    def get_task_snapshot(self) -> TaskSnapshot:
        """返回任务快照对象，避免外部误改内部缓存。"""

        with self.lock:
            return self.task_snapshot

    def is_busy(self) -> bool:
        """统一提供忙碌态布尔值。"""

        with self.lock:
            return self.task_snapshot.busy

    def apply_event(self, topic: str, payload: dict[str, object]) -> None:
        """统一把 SSE topic 合并进本地状态仓库。"""

        if topic == EventTopic.PROJECT_CHANGED.value:
            if bool(payload.get("loaded", False)):
                self.hydrate_project(ProjectSnapshot.from_dict(payload))
            else:
                self.reset_project()
        elif topic == EventTopic.TASK_STATUS_CHANGED.value:
            self.merge_task_status(TaskStatusUpdate.from_dict(payload))
        elif topic == EventTopic.TASK_PROGRESS_CHANGED.value:
            self.merge_task_progress(TaskProgressUpdate.from_dict(payload))
