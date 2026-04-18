from typing import Any

from api.Bridge.EventTopic import EventTopic
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact
from base.Base import Base
from model.Api.ExtraModels import ExtraTaskState


class EventBridge:
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
        elif event in (
            Base.Event.TRANSLATION_RESET_ALL,
            Base.Event.TRANSLATION_RESET_FAILED,
        ):
            if self.is_terminal_translation_reset_event(data):
                return (
                    EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value,
                    self.build_translation_reset_payload(event, data),
                )
            else:
                return None, {}
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
        elif event == Base.Event.WORKBENCH_REFRESH:
            return (
                EventTopic.WORKBENCH_SNAPSHOT_CHANGED.value,
                self.build_workbench_refresh_payload(data),
            )
        elif event == Base.Event.WORKBENCH_SNAPSHOT:
            snapshot = data.get("snapshot", {})
            return (
                EventTopic.WORKBENCH_SNAPSHOT_CHANGED.value,
                {"snapshot": snapshot if isinstance(snapshot, dict) else {}},
            )
        elif event == Base.Event.PROOFREADING_REFRESH:
            return (
                EventTopic.PROOFREADING_SNAPSHOT_INVALIDATED.value,
                self.build_proofreading_refresh_payload(data),
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
                EventTopic.SETTINGS_CHANGED.value,
                payload,
            )
        elif event == Base.Event.EXTRA_TS_CONVERSION_PROGRESS:
            return (
                EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
                self.build_extra_task_payload(data, finished=False),
            )
        elif event == Base.Event.EXTRA_TS_CONVERSION_FINISHED:
            return (
                EventTopic.EXTRA_TS_CONVERSION_FINISHED.value,
                self.build_extra_task_payload(data, finished=True),
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
        status = "STOPPING" if stopping else sub_event
        return {
            "task_type": task_type,
            "status": status,
            "busy": status not in ("DONE", "ERROR", "IDLE"),
        }

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

    def is_terminal_translation_reset_event(self, data: dict[str, Any]) -> bool:
        """只在 reset 进入终态时通知校对失效，避免请求态触发无意义重刷。"""

        sub_event = data.get("sub_event")
        return sub_event in (Base.SubEvent.DONE, Base.SubEvent.ERROR)

    def build_translation_reset_payload(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """把翻译 reset 收口成稳定的 proofreading 失效原因，供 Electron 前端复用。"""

        if event == Base.Event.TRANSLATION_RESET_ALL:
            reset_scope = "all"
        else:
            reset_scope = "failed"

        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.ERROR:
            reason = "translation_reset_error"
        else:
            reason = "translation_reset"

        return {
            "reason": reason,
            "reset_scope": reset_scope,
        }

    def build_proofreading_refresh_payload(
        self,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """把校对刷新请求裁成稳定的最小失效载荷。"""

        payload: dict[str, Any] = {
            "reason": str(data.get("reason", "")),
            "scope": str(data.get("scope", "global") or "global"),
        }

        keys = data.get("keys")
        if isinstance(keys, list):
            payload["keys"] = [str(key) for key in keys]

        rel_paths = data.get("rel_paths")
        if isinstance(rel_paths, list):
            payload["rel_paths"] = [str(rel_path) for rel_path in rel_paths]

        removed_rel_paths = data.get("removed_rel_paths")
        if isinstance(removed_rel_paths, list):
            payload["removed_rel_paths"] = [
                str(rel_path) for rel_path in removed_rel_paths
            ]

        source_event = data.get("source_event")
        if source_event is not None:
            payload["source_event"] = str(getattr(source_event, "value", source_event))

        trigger_reason = str(data.get("trigger_reason", ""))
        if trigger_reason != "":
            payload["trigger_reason"] = trigger_reason

        return payload

    def build_workbench_refresh_payload(
        self,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """把工作台刷新事件裁成稳定的结构化载荷。"""

        payload: dict[str, Any] = {
            "reason": str(data.get("reason", "")),
            "scope": str(data.get("scope", "global") or "global"),
        }

        rel_paths = data.get("rel_paths")
        if isinstance(rel_paths, list):
            payload["rel_paths"] = [str(rel_path) for rel_path in rel_paths]

        removed_rel_paths = data.get("removed_rel_paths")
        if isinstance(removed_rel_paths, list):
            payload["removed_rel_paths"] = [
                str(rel_path) for rel_path in removed_rel_paths
            ]

        if "order_changed" in data:
            payload["order_changed"] = bool(data.get("order_changed"))

        return payload
