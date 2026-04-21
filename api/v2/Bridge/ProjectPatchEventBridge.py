from __future__ import annotations

from typing import Any
from typing import Callable

from api.v2.Bridge.PublicEventBridge import PublicEventBridge
from base.Base import Base


class ProjectPatchEventBridge:
    """把内部任务终态裁成 ProjectStore 可直接消费的 patch 事件。"""

    PROJECT_PATCH_TOPIC: str = "project.patch"

    def __init__(
        self,
        runtime_service: Any | None = None,
        task_snapshot_builder: Callable[[str], dict[str, object]] | None = None,
    ) -> None:
        self.runtime_service = runtime_service
        self.task_snapshot_builder = task_snapshot_builder
        self.event_bridge = PublicEventBridge()

    def map_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        """仅暴露 V2 运行态真正需要的 task patch 事件。"""

        if self.is_project_runtime_patch_event(event):
            return self.PROJECT_PATCH_TOPIC, dict(data)

        if self.is_translation_done_event(event, data):
            return self.PROJECT_PATCH_TOPIC, self.build_translation_task_patch(data)

        if self.is_analysis_done_event(event, data):
            return self.PROJECT_PATCH_TOPIC, self.build_analysis_task_patch(data)

        if self.is_analysis_import_glossary_done_event(event, data):
            return (
                self.PROJECT_PATCH_TOPIC,
                self.build_analysis_import_glossary_patch(),
            )

        if self.is_translation_reset_done_event(event, data):
            return (
                self.PROJECT_PATCH_TOPIC,
                self.build_translation_reset_refresh_patch(event),
            )

        if self.is_analysis_reset_done_event(event, data):
            return (
                self.PROJECT_PATCH_TOPIC,
                self.build_analysis_reset_refresh_patch(event),
            )

        if self.is_project_runtime_refresh_event(event):
            return self.PROJECT_PATCH_TOPIC, self.build_runtime_refresh_patch(data)

        return self.event_bridge.map_event(event, data)

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

    def build_analysis_import_glossary_patch(self) -> dict[str, Any]:
        """把候选术语导入终态裁成 quality/analysis/task patch。"""

        patch: list[dict[str, object]] = []
        updated_sections: list[str] = []
        quality_block = self.build_quality_block()
        if quality_block:
            patch.append(
                {
                    "op": "replace_quality",
                    "quality": quality_block,
                }
            )
            updated_sections.append("quality")

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

        section_revisions = self.build_section_revisions(updated_sections)
        return {
            "source": "analysis_import_glossary",
            "projectRevision": max(section_revisions.values(), default=0),
            "updatedSections": updated_sections,
            "patch": patch,
            "sectionRevisions": section_revisions,
        }

    def build_translation_reset_refresh_patch(
        self,
        event: Base.Event,
    ) -> dict[str, Any]:
        """翻译 reset 完成后，要求前端重拉受影响运行态，解除工作台确认态。"""

        if event == Base.Event.TRANSLATION_RESET_ALL:
            updated_sections = ["items", "analysis", "task"]
            source = "translation_reset_all"
        else:
            updated_sections = ["items", "task"]
            source = "translation_reset_failed"

        return {
            "source": source,
            "updatedSections": updated_sections,
        }

    def build_analysis_reset_refresh_patch(
        self,
        event: Base.Event,
    ) -> dict[str, Any]:
        """分析 reset 完成后，要求前端重拉分析相关运行态。"""

        source = (
            "analysis_reset_all"
            if event == Base.Event.ANALYSIS_RESET_ALL
            else "analysis_reset_failed"
        )
        return {
            "source": source,
            "updatedSections": ["analysis", "task"],
        }

    def build_runtime_refresh_patch(self, data: dict[str, Any]) -> dict[str, Any]:
        """文件操作完成后只声明受影响 section，让前端主动重拉 V2 运行态。"""

        updated_sections = self.normalize_updated_sections(
            data.get("updatedSections", data.get("updated_sections", []))
        )
        if not updated_sections:
            updated_sections = ["files", "items", "analysis"]

        payload: dict[str, Any] = {
            "source": str(data.get("source", "project_runtime")),
            "updatedSections": updated_sections,
        }

        if "projectRevision" in data or "project_revision" in data:
            payload["projectRevision"] = int(
                data.get("projectRevision", data.get("project_revision", 0)) or 0
            )

        return payload

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

    def is_analysis_import_glossary_done_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> bool:
        """分析候选导入成功后，需要把质量相关区块重新回灌到运行态。"""

        return (
            event == Base.Event.ANALYSIS_IMPORT_GLOSSARY
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def is_translation_reset_done_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> bool:
        """翻译 reset 只在成功终态时推进运行态刷新。"""

        return (
            event
            in (
                Base.Event.TRANSLATION_RESET_ALL,
                Base.Event.TRANSLATION_RESET_FAILED,
            )
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def is_analysis_reset_done_event(
        self,
        event: Base.Event,
        data: dict[str, Any],
    ) -> bool:
        """分析 reset 只在成功终态时推进运行态刷新。"""

        return (
            event
            in (
                Base.Event.ANALYSIS_RESET_ALL,
                Base.Event.ANALYSIS_RESET_FAILED,
            )
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def is_project_runtime_refresh_event(self, event: Base.Event) -> bool:
        """只接显式运行态刷新事件，避免旧失效通知误闯回 V2 主路径。"""

        return event == Base.Event.PROJECT_RUNTIME_REFRESH

    def is_project_runtime_patch_event(self, event: Base.Event) -> bool:
        """显式补丁事件直接透传到 `project.patch`。"""

        return event == Base.Event.PROJECT_RUNTIME_PATCH

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
                return [dict(record) for record in records if isinstance(record, dict)]

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

    def build_quality_block(self) -> dict[str, object]:
        """从 runtime_service 读取最新质量块，供术语导入后刷新术语页。"""

        runtime_builder = getattr(self.runtime_service, "build_quality_block", None)
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

    def build_section_revisions(
        self,
        updated_sections: list[str],
    ) -> dict[str, int]:
        """优先复用运行态 revision，避免桥接层随手递增假版本。"""

        get_section_revision = getattr(
            self.runtime_service, "get_section_revision", None
        )
        if not callable(get_section_revision):
            return {}

        section_revisions: dict[str, int] = {}
        for section in updated_sections:
            section_revisions[section] = int(get_section_revision(section) or 0)
        return section_revisions

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

    def normalize_updated_sections(self, raw_sections: Any) -> list[str]:
        """把受影响 section 收口成前端可识别的稳定列表。"""

        if not isinstance(raw_sections, list):
            return []

        updated_sections: list[str] = []
        for raw_section in raw_sections:
            section = str(raw_section).strip()
            if section == "":
                continue
            if section in updated_sections:
                continue
            updated_sections.append(section)
        return updated_sections
