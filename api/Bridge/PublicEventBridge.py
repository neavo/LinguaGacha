from typing import Any

from api.Bridge.PublicEventTopic import PublicEventTopic
from base.Base import Base
from api.Models.Extra import ExtraTaskState


class PublicEventBridge:
    """把内部事件裁剪为对外稳定 topic。"""

    EXTRA_TS_CONVERSION_TASK_ID: str = "extra_ts_conversion"

    def map_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        """仅映射明确允许出站的事件，其余事件统一忽略。"""

        if event == Base.Event.TRANSLATION_PROGRESS:
            return (
                PublicEventTopic.TASK_PROGRESS_CHANGED.value,
                self.build_task_progress_payload("translation", data),
            )
        elif event == Base.Event.TRANSLATION_TASK:
            return (
                PublicEventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("translation", data),
            )
        elif event == Base.Event.TRANSLATION_REQUEST_STOP:
            return (
                PublicEventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("translation", data, stopping=True),
            )
        elif event == Base.Event.ANALYSIS_PROGRESS:
            return (
                PublicEventTopic.TASK_PROGRESS_CHANGED.value,
                self.build_task_progress_payload("analysis", data),
            )
        elif event == Base.Event.ANALYSIS_TASK:
            return (
                PublicEventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("analysis", data),
            )
        elif event == Base.Event.ANALYSIS_REQUEST_STOP:
            return (
                PublicEventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("analysis", data, stopping=True),
            )
        elif event == Base.Event.PROJECT_LOADED:
            return (
                PublicEventTopic.PROJECT_CHANGED.value,
                {
                    "loaded": True,
                    "path": str(data.get("path", "")),
                },
            )
        elif event == Base.Event.PROJECT_UNLOADED:
            return (
                PublicEventTopic.PROJECT_CHANGED.value,
                {
                    "loaded": False,
                    "path": str(data.get("path", "")),
                },
            )
        elif event == Base.Event.CONFIG_UPDATED:
            keys = data.get("keys", [])
            normalized_keys = (
                [str(key) for key in keys] if isinstance(keys, list) else []
            )
            payload: dict[str, Any] = {"keys": normalized_keys}
            settings = data.get("settings")
            if isinstance(settings, dict):
                payload["settings"] = settings
            return (
                PublicEventTopic.SETTINGS_CHANGED.value,
                payload,
            )
        elif event == Base.Event.EXTRA_TS_CONVERSION_PROGRESS:
            return (
                PublicEventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
                self.build_extra_task_payload(data, finished=False),
            )
        elif event == Base.Event.EXTRA_TS_CONVERSION_FINISHED:
            return (
                PublicEventTopic.EXTRA_TS_CONVERSION_FINISHED.value,
                self.build_extra_task_payload(data, finished=True),
            )
        else:
            return None, {}

    def build_task_progress_payload(
        self,
        task_type: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """任务进度只暴露 UI 真正需要的稳定快照字段。"""

        # 为什么：任务进度事件既可能是全量快照，也可能只是“实时任务数”补丁。
        # 这里只转发真正存在的字段，避免补丁事件把其他统计误清零。
        payload: dict[str, Any] = {
            "task_type": task_type,
        }
        if "request_in_flight_count" in data:
            payload["request_in_flight_count"] = int(
                data.get("request_in_flight_count", 0) or 0
            )
        if "line" in data:
            payload["line"] = int(data.get("line", 0) or 0)
        if "total_line" in data:
            payload["total_line"] = int(data.get("total_line", 0) or 0)
        if "processed_line" in data:
            payload["processed_line"] = int(data.get("processed_line", 0) or 0)
        if "error_line" in data:
            payload["error_line"] = int(data.get("error_line", 0) or 0)
        if "total_tokens" in data:
            payload["total_tokens"] = int(data.get("total_tokens", 0) or 0)
        if "total_output_tokens" in data:
            payload["total_output_tokens"] = int(
                data.get("total_output_tokens", 0) or 0
            )
        if "total_input_tokens" in data:
            payload["total_input_tokens"] = int(data.get("total_input_tokens", 0) or 0)
        if "start_time" in data:
            payload["start_time"] = float(data.get("start_time", 0.0) or 0.0)
        if "time" in data:
            payload["time"] = float(data.get("time", 0.0) or 0.0)
        if "analysis_candidate_count" in data:
            payload["analysis_candidate_count"] = int(
                data.get("analysis_candidate_count", 0) or 0
            )
        return payload

    def build_task_status_payload(
        self,
        task_type: str,
        data: dict[str, Any],
        stopping: bool = False,
    ) -> dict[str, Any]:
        """任务生命周期事件对外统一为状态变更通知。"""

        sub_event = str(
            getattr(data.get("sub_event"), "value", data.get("sub_event", ""))
        )
        status = "STOPPING" if stopping else self.resolve_task_status(sub_event, data)
        return {
            "task_type": task_type,
            "status": status,
            "busy": status not in ("DONE", "ERROR", "IDLE"),
        }

    def resolve_task_status(
        self,
        sub_event: str,
        data: dict[str, Any],
    ) -> str:
        """DONE 需要结合终态语义映射，避免失败任务继续伪装成成功。"""

        if sub_event != Base.SubEvent.DONE.value:
            return sub_event

        final_status = str(data.get("final_status", "SUCCESS"))
        if final_status == "FAILED":
            return "ERROR"
        if final_status == "STOPPED":
            return "IDLE"
        return "DONE"

    def build_extra_task_payload(
        self,
        data: dict[str, Any],
        *,
        finished: bool,
    ) -> dict[str, Any]:
        """Extra 长任务只暴露页面需要的最小进度字段，避免协议提前膨胀。"""

        return {
            "task_id": str(
                data.get("task_id", self.EXTRA_TS_CONVERSION_TASK_ID)
                or self.EXTRA_TS_CONVERSION_TASK_ID
            ),
            "phase": str(
                data.get(
                    "phase",
                    (
                        ExtraTaskState.PHASE_FINISHED
                        if finished
                        else ExtraTaskState.PHASE_RUNNING
                    ),
                )
            ),
            "message": str(data.get("message", "")),
            "current": int(data.get("current", 0) or 0),
            "total": int(data.get("total", 0) or 0),
            "finished": finished,
        }
