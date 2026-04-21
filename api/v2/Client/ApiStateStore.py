import threading

from api.v2.Bridge.EventTopic import EventTopic
from api.v2.Models.Extra import ExtraTaskState
from api.v2.Models.Project import ProjectSnapshot
from api.v2.Models.Task import TaskProgressUpdate
from api.v2.Models.Task import TaskSnapshot
from api.v2.Models.Task import TaskStatusUpdate


class ApiStateStore:
    """维护 UI 当前真正需要的冻结快照对象。"""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.project_snapshot: ProjectSnapshot = ProjectSnapshot.from_dict({})
        self.task_snapshot: TaskSnapshot = TaskSnapshot.from_dict({})
        self.extra_task_states: dict[str, ExtraTaskState] = {}

    def hydrate_project(self, snapshot: ProjectSnapshot) -> None:
        """用服务端快照覆盖本地工程状态，保持单一缓存入口。"""

        with self.lock:
            self.project_snapshot = snapshot
            self.extra_task_states = {}

    def reset_project(self) -> None:
        """工程关闭后恢复到未加载态，避免 UI 继续读到陈旧路径。"""

        with self.lock:
            self.project_snapshot = ProjectSnapshot.from_dict({})
            self.extra_task_states = {}

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

    def merge_extra_task_state(
        self,
        payload: dict[str, object],
        *,
        finished: bool,
    ) -> None:
        """把 Extra 长任务事件合并成冻结状态，避免页面自己维护进度缓存。"""

        task_id = str(payload.get("task_id", ""))
        if task_id != "":
            with self.lock:
                current_state = self.extra_task_states.get(
                    task_id,
                    ExtraTaskState(task_id=task_id),
                )
                self.extra_task_states[task_id] = current_state.merge_dict(
                    payload,
                    finished=finished,
                )

    def get_extra_task_state(self, task_id: str) -> ExtraTaskState | None:
        """按任务标识读取 Extra 长任务状态，未命中时返回 None 区分状态丢失。"""

        with self.lock:
            return self.extra_task_states.get(task_id)

    def clear_extra_task_state(self, task_id: str) -> None:
        """启动同标识新任务前清掉陈旧快照，避免旧终态污染新的生命周期。"""

        if task_id == "":
            return

        with self.lock:
            self.extra_task_states.pop(task_id, None)

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
        elif topic == EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value:
            self.merge_extra_task_state(payload, finished=False)
        elif topic == EventTopic.EXTRA_TS_CONVERSION_FINISHED.value:
            self.merge_extra_task_state(payload, finished=True)
