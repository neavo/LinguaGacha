from typing import Any

from base.Base import Base
from api.Bridge.EventTopic import EventTopic
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact


class EventBridge:
    """把内部事件裁剪为对外稳定 topic。"""

    def map_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        """仅映射明确允许出站的事件，其余事件统一忽略。"""

        if event == Base.Event.TRANSLATION_PROGRESS:
            return (
                EventTopic.TASK_PROGRESS_CHANGED.value,
                self.build_task_progress_payload("translation", data),
            )
        elif event == Base.Event.TRANSLATION_TASK:
            return (
                EventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("translation", data),
            )
        elif event == Base.Event.TRANSLATION_REQUEST_STOP:
            return (
                EventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("translation", data, stopping=True),
            )
        elif event == Base.Event.ANALYSIS_PROGRESS:
            return (
                EventTopic.TASK_PROGRESS_CHANGED.value,
                self.build_task_progress_payload("analysis", data),
            )
        elif event == Base.Event.ANALYSIS_TASK:
            return (
                EventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("analysis", data),
            )
        elif event == Base.Event.ANALYSIS_REQUEST_STOP:
            return (
                EventTopic.TASK_STATUS_CHANGED.value,
                self.build_task_status_payload("analysis", data, stopping=True),
            )
        elif event == Base.Event.PROJECT_LOADED:
            return (
                EventTopic.PROJECT_CHANGED.value,
                {
                    "loaded": True,
                    "path": str(data.get("path", "")),
                },
            )
        elif event == Base.Event.PROJECT_UNLOADED:
            return (
                EventTopic.PROJECT_CHANGED.value,
                {
                    "loaded": False,
                    "path": str(data.get("path", "")),
                },
            )
        elif event == Base.Event.WORKBENCH_SNAPSHOT:
            snapshot = data.get("snapshot", {})
            return (
                EventTopic.WORKBENCH_SNAPSHOT_CHANGED.value,
                {"snapshot": snapshot if isinstance(snapshot, dict) else {}},
            )
        elif event == Base.Event.CONFIG_UPDATED:
            keys = data.get("keys", [])
            normalized_keys = (
                [str(key) for key in keys] if isinstance(keys, list) else []
            )
            return (
                EventTopic.SETTINGS_CHANGED.value,
                {"keys": normalized_keys},
            )
        elif event == Base.Event.QUALITY_RULE_UPDATE:
            relevant_rule_types, relevant_meta_keys = (
                ProofreadingRuleImpact.extract_relevant_rule_update(data)
            )
            if relevant_rule_types or relevant_meta_keys:
                return (
                    EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value,
                    {
                        "reason": "quality_rule_update",
                        "rule_types": relevant_rule_types,
                        "meta_keys": relevant_meta_keys,
                    },
                )
            else:
                return None, {}
        else:
            return None, {}

    def build_task_progress_payload(
        self,
        task_type: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """任务进度只暴露 UI 真正需要的稳定快照字段。"""

        return {
            "task_type": task_type,
            "line": int(data.get("line", 0) or 0),
            "total_line": int(data.get("total_line", 0) or 0),
            "processed_line": int(data.get("processed_line", 0) or 0),
            "error_line": int(data.get("error_line", 0) or 0),
            "total_tokens": int(data.get("total_tokens", 0) or 0),
            "total_output_tokens": int(data.get("total_output_tokens", 0) or 0),
            "total_input_tokens": int(data.get("total_input_tokens", 0) or 0),
            "start_time": float(data.get("start_time", 0.0) or 0.0),
            "time": float(data.get("time", 0.0) or 0.0),
        }

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
        status = "STOPPING" if stopping else sub_event
        return {
            "task_type": task_type,
            "status": status,
            "busy": status not in ("DONE", "ERROR", "IDLE"),
        }
