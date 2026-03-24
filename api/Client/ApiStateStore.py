import threading
from typing import Any

from api.Bridge.EventTopic import EventTopic


class ApiStateStore:
    """维护 UI 当前真正需要的序列化快照。"""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.project_snapshot: dict[str, Any] = {
            "loaded": False,
            "path": "",
        }
        self.task_snapshot: dict[str, Any] = {
            "task_type": "",
            "status": "IDLE",
            "busy": False,
            "line": 0,
        }

    def hydrate_project(self, snapshot: dict[str, Any]) -> None:
        """用服务端快照覆盖本地工程状态，保持单一缓存入口。"""

        with self.lock:
            self.project_snapshot = {
                "loaded": bool(snapshot.get("loaded", False)),
                "path": str(snapshot.get("path", "")),
            }

    def reset_project(self) -> None:
        """工程关闭后恢复到未加载态，避免 UI 继续读到陈旧路径。"""

        with self.lock:
            self.project_snapshot = {
                "loaded": False,
                "path": "",
            }

    def is_project_loaded(self) -> bool:
        """给 UI 提供稳定布尔值，减少页面自己猜状态。"""

        with self.lock:
            return bool(self.project_snapshot["loaded"])

    def get_project_path(self) -> str:
        """统一读取当前工程路径。"""

        with self.lock:
            return str(self.project_snapshot["path"])

    def get_project_snapshot(self) -> dict[str, Any]:
        """返回快照副本，避免外部持有内部可变引用。"""

        with self.lock:
            return dict(self.project_snapshot)

    def hydrate_task(self, snapshot: dict[str, Any]) -> None:
        """用任务快照覆盖本地状态，供页面首屏 hydration 使用。"""

        normalized_snapshot = dict(snapshot)
        normalized_snapshot.update(
            {
                "task_type": str(snapshot.get("task_type", "")),
                "status": str(snapshot.get("status", "IDLE")),
                "busy": bool(snapshot.get("busy", False)),
                "request_in_flight_count": int(
                    snapshot.get("request_in_flight_count", 0) or 0
                ),
                "line": int(snapshot.get("line", 0) or 0),
                "total_line": int(snapshot.get("total_line", 0) or 0),
                "processed_line": int(snapshot.get("processed_line", 0) or 0),
                "error_line": int(snapshot.get("error_line", 0) or 0),
                "total_tokens": int(snapshot.get("total_tokens", 0) or 0),
                "total_output_tokens": int(snapshot.get("total_output_tokens", 0) or 0),
                "total_input_tokens": int(snapshot.get("total_input_tokens", 0) or 0),
                "time": float(snapshot.get("time", 0.0) or 0.0),
                "start_time": float(snapshot.get("start_time", 0.0) or 0.0),
            }
        )
        with self.lock:
            self.task_snapshot = normalized_snapshot

    def merge_task_progress(self, snapshot: dict[str, Any]) -> None:
        """SSE 进度增量只覆盖任务快照中的进度字段。"""

        with self.lock:
            next_snapshot = dict(self.task_snapshot)
        next_snapshot.update(
            {
                "task_type": str(snapshot.get("task_type", next_snapshot["task_type"])),
                "line": int(snapshot.get("line", next_snapshot.get("line", 0)) or 0),
                "total_line": int(
                    snapshot.get("total_line", next_snapshot.get("total_line", 0)) or 0
                ),
                "processed_line": int(
                    snapshot.get(
                        "processed_line",
                        next_snapshot.get("processed_line", 0),
                    )
                    or 0
                ),
                "error_line": int(
                    snapshot.get("error_line", next_snapshot.get("error_line", 0)) or 0
                ),
                "total_tokens": int(
                    snapshot.get(
                        "total_tokens",
                        next_snapshot.get("total_tokens", 0),
                    )
                    or 0
                ),
                "total_output_tokens": int(
                    snapshot.get(
                        "total_output_tokens",
                        next_snapshot.get("total_output_tokens", 0),
                    )
                    or 0
                ),
                "total_input_tokens": int(
                    snapshot.get(
                        "total_input_tokens",
                        next_snapshot.get("total_input_tokens", 0),
                    )
                    or 0
                ),
                "start_time": float(
                    snapshot.get("start_time", next_snapshot.get("start_time", 0.0))
                    or 0.0
                ),
                "time": float(
                    snapshot.get("time", next_snapshot.get("time", 0.0)) or 0.0
                ),
            }
        )
        with self.lock:
            self.task_snapshot = next_snapshot

    def merge_task_status(self, snapshot: dict[str, Any]) -> None:
        """SSE 状态增量只覆盖任务快照中的状态字段。"""

        with self.lock:
            next_snapshot = dict(self.task_snapshot)
        next_snapshot.update(
            {
                "task_type": str(snapshot.get("task_type", next_snapshot["task_type"])),
                "status": str(
                    snapshot.get("status", next_snapshot.get("status", "IDLE"))
                ),
                "busy": bool(snapshot.get("busy", next_snapshot.get("busy", False))),
            }
        )
        with self.lock:
            self.task_snapshot = next_snapshot

    def get_task_snapshot(self) -> dict[str, Any]:
        """返回任务快照副本，避免外部误改内部缓存。"""

        with self.lock:
            return dict(self.task_snapshot)

    def is_busy(self) -> bool:
        """统一提供忙碌态布尔值。"""

        with self.lock:
            return bool(self.task_snapshot.get("busy", False))

    def apply_event(self, topic: str, payload: dict[str, Any]) -> None:
        """统一把 SSE topic 合并进本地状态仓库。"""

        if topic == EventTopic.PROJECT_CHANGED.value:
            if bool(payload.get("loaded", False)):
                self.hydrate_project(payload)
            else:
                self.reset_project()
        elif topic == EventTopic.TASK_STATUS_CHANGED.value:
            self.merge_task_status(payload)
        elif topic == EventTopic.TASK_PROGRESS_CHANGED.value:
            self.merge_task_progress(payload)
