from __future__ import annotations

from typing import Any
from typing import Callable

from api.Bridge.EventBridge import EventBridge
from base.Base import Base


class V2EventBridge:
    """把内部任务终态裁成 V2 ProjectStore 可直接消费的 patch 事件。"""

    PROJECT_PATCH_TOPIC: str = "project.patch"

    def __init__(
        self,
        runtime_service: Any | None = None,
        task_snapshot_builder: Callable[[str], dict[str, object]] | None = None,
    ) -> None:
        self.runtime_service = runtime_service
        self.task_snapshot_builder = task_snapshot_builder
        self.event_bridge = EventBridge()

    def map_event(
        self,
        event: Base.Event | str,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        """仅暴露 V2 运行态真正需要的 task patch 事件。"""

        if self.is_translation_done_event(event, data):
            return self.PROJECT_PATCH_TOPIC, self.build_translation_task_patch(data)

        if self.is_analysis_done_event(event, data):
            return self.PROJECT_PATCH_TOPIC, self.build_analysis_task_patch(data)

        if isinstance(event, Base.Event):
            return self.event_bridge.map_event(event, data)

        return None, {}

    def build_translation_task_patch(self, data: dict[str, Any]) -> dict[str, Any]:
        """把翻译终态统一裁成 items/task patch，替代页面失效通知。"""

        patch: list[dict[str, object]] = []
        updated_sections: list[str] = []
        item_ids = self.normalize_item_ids(data.get("item_ids", []))
        items = self.build_item_records(item_ids, data)
        if items:
            patch.append(
                {
                    "op": "merge_items",
                    "items": items,
                }
            )
            updated_sections.append("items")

        task_snapshot = self.build_task_snapshot("translation")
        if task_snapshot:
            patch.append(
                {
                    "op": "replace_task",
                    "task": task_snapshot,
                }
            )
            updated_sections.append("task")

        return {
            "source": "task",
            "projectRevision": int(data.get("revision", 0) or 0),
            "updatedSections": updated_sections,
            "patch": patch,
        }

    def build_analysis_task_patch(self, data: dict[str, Any]) -> dict[str, Any]:
        """把分析终态统一裁成 analysis/task patch，供规则页派生直接回灌。"""

        patch: list[dict[str, object]] = []
        updated_sections: list[str] = []
        analysis_block = self.build_analysis_block()
        if analysis_block:
            patch.append(
                {
                    "op": "replace_analysis",
                    "analysis": analysis_block,
                }
            )
            updated_sections.append("analysis")

        task_snapshot = self.build_task_snapshot("analysis")
        if task_snapshot:
            patch.append(
                {
                    "op": "replace_task",
                    "task": task_snapshot,
                }
            )
            updated_sections.append("task")

        return {
            "source": "task",
            "projectRevision": int(data.get("revision", 0) or 0),
            "updatedSections": updated_sections,
            "patch": patch,
        }

    def is_translation_done_event(
        self,
        event: Base.Event | str,
        data: dict[str, Any],
    ) -> bool:
        """兼容测试里的语义事件名，以及真实运行时的翻译终态事件。"""

        if event == "translation_done":
            return True
        return (
            event == Base.Event.TRANSLATION_TASK
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def is_analysis_done_event(
        self,
        event: Base.Event | str,
        data: dict[str, Any],
    ) -> bool:
        """兼容测试里的语义事件名，以及真实运行时的分析终态事件。"""

        if event == "analysis_done":
            return True
        return (
            event == Base.Event.ANALYSIS_TASK
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def build_item_records(
        self,
        item_ids: list[int],
        data: dict[str, Any],
    ) -> list[dict[str, object]]:
        """优先从 runtime_service 读取稳定条目记录，缺失时再回退到事件载荷。"""

        runtime_builder = getattr(self.runtime_service, "build_item_records", None)
        if callable(runtime_builder):
            records = runtime_builder(item_ids)
            if isinstance(records, list):
                return [
                    dict(record)
                    for record in records
                    if isinstance(record, dict)
                ]

        raw_items = data.get("items", [])
        if not isinstance(raw_items, list):
            return []

        return [dict(item) for item in raw_items if isinstance(item, dict)]

    def build_analysis_block(self) -> dict[str, object]:
        """从 runtime_service 读取最新分析块，避免桥接层重写领域拼装。"""

        runtime_builder = getattr(self.runtime_service, "build_analysis_block", None)
        if callable(runtime_builder):
            payload = runtime_builder()
            if isinstance(payload, dict):
                return payload
        return {}

    def build_task_snapshot(self, task_type: str) -> dict[str, object]:
        """统一读取当前任务快照，供 task patch 回灌桌面壳层。"""

        if self.task_snapshot_builder is None:
            return {}

        payload = self.task_snapshot_builder(task_type)
        if isinstance(payload, dict):
            return payload
        return {}

    def normalize_item_ids(self, raw_item_ids: Any) -> list[int]:
        """把 patch 里的条目 id 收口成稳定整数列表。"""

        if not isinstance(raw_item_ids, list):
            return []

        item_ids: list[int] = []
        for raw_item_id in raw_item_ids:
            try:
                item_id = int(raw_item_id)
            except (TypeError, ValueError):
                continue
            if item_id in item_ids:
                continue
            item_ids.append(item_id)
        return item_ids
