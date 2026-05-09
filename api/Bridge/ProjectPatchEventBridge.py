from __future__ import annotations

from typing import Any
from typing import Callable

from api.Bridge.PublicEventBridge import PublicEventBridge
from base.Base import Base


class ProjectPatchEventBridge:
    """把内部任务终态裁成 ProjectStore 可直接消费的 patch 事件。"""

    PROJECT_PATCH_TOPIC: str = "project.patch"

    def __init__(
        self,
        task_snapshot_builder: Callable[[str], dict[str, object]] | None = None,
    ) -> None:
        self.task_snapshot_builder = task_snapshot_builder
        self.event_bridge = PublicEventBridge()

    def map_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        """仅暴露项目运行态真正需要的 task patch 事件。"""

        if self.is_project_runtime_patch_event(event):
            return self.PROJECT_PATCH_TOPIC, dict(data)

        if self.is_translation_done_event(event, data):
            return self.PROJECT_PATCH_TOPIC, self.build_translation_task_patch(data)

        if self.is_analysis_done_event(event, data):
            return self.PROJECT_PATCH_TOPIC, self.build_analysis_task_patch(data)

        return self.event_bridge.map_event(event, data)

    def build_translation_task_patch(self, data: dict[str, Any]) -> dict[str, Any]:
        """把翻译终态统一裁成 items/task patch，替代页面失效通知。"""

        patch: list[dict[str, object]] = []
        updated_sections: list[str] = []
        item_ids = self.normalize_item_ids(data.get("item_ids", []))
        if item_ids:
            patch.append(
                {
                    "op": "merge_items",
                    "item_ids": item_ids,
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
            "updatedSections": updated_sections,
            "patch": patch,
        }

    def build_analysis_task_patch(self, data: dict[str, Any]) -> dict[str, Any]:
        """把分析终态统一裁成 analysis/task patch，供规则页派生直接回灌。"""

        patch: list[dict[str, object]] = []
        updated_sections: list[str] = []
        patch.append({"op": "replace_analysis"})
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
            "updatedSections": updated_sections,
            "patch": patch,
        }

    def is_translation_done_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> bool:
        """仅在真实运行时翻译任务进入 DONE 时生成项目 patch。"""

        return (
            event == Base.Event.TRANSLATION_TASK
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def is_analysis_done_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> bool:
        """仅在真实运行时分析任务进入 DONE 时生成项目 patch。"""

        return (
            event == Base.Event.ANALYSIS_TASK
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def is_project_runtime_patch_event(self, event: Base.Event) -> bool:
        """显式补丁事件直接透传到 `project.patch`。"""

        return event == Base.Event.PROJECT_RUNTIME_PATCH

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
            except TypeError, ValueError:
                continue
            if item_id in item_ids:
                continue
            item_ids.append(item_id)
        return item_ids
