from typing import Any

from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService
from module.Data.Quality.QualityRuleFacadeService import QualityRuleFacadeService
from api.v2.Contract.ProjectPayloads import ProjectPreviewPayload
from api.v2.Contract.ProjectPayloads import ProjectSnapshotPayload


class ProjectAppService:
    """工程用例层，负责把数据层调用收口为稳定响应载荷。"""

    def __init__(self, project_manager: Any | None = None) -> None:
        self.project_manager = (
            project_manager if project_manager is not None else DataManager.get()
        )
        quality_rule_service = getattr(
            self.project_manager,
            "quality_rule_service",
            self.project_manager,
        )
        meta_service = getattr(
            self.project_manager,
            "meta_service",
            self.project_manager,
        )
        self.quality_rule_facade = QualityRuleFacadeService(
            quality_rule_service,
            meta_service,
        )
        self.runtime_service = ProjectRuntimeService(self.project_manager)

    def load_project(self, request: dict[str, str]) -> dict[str, object]:
        """加载既有工程，并返回序列化后的工程快照。"""

        path = str(request.get("path", ""))
        self.project_manager.load_project(path)
        return {"project": self.build_project_snapshot(path)}

    def create_project(self, request: dict[str, str]) -> dict[str, object]:
        """创建工程后立即加载，保证 UI 首次拿到的是统一快照。"""

        source_path = str(request.get("source_path", ""))
        output_path = str(request.get("path", ""))
        self.project_manager.create_project(source_path, output_path)
        self.project_manager.load_project(output_path)
        return {"project": self.build_project_snapshot(output_path)}

    def get_project_snapshot(self, request: dict[str, str]) -> dict[str, object]:
        """提供显式查询接口，供 UI 首屏 hydration 使用。"""

        del request
        return {"project": self.build_project_snapshot()}

    def unload_project(self, request: dict[str, str]) -> dict[str, object]:
        """关闭当前工程，并返回重置后的快照。"""

        del request
        self.project_manager.unload_project()
        return {"project": ProjectSnapshotPayload(path="", loaded=False).to_dict()}

    def collect_source_files(self, request: dict[str, str]) -> dict[str, object]:
        """把源目录扫描结果转换为纯 JSON 列表。"""

        path = str(request.get("path", ""))
        source_files = self.project_manager.collect_source_files(path)
        return {"source_files": [str(file_path) for file_path in source_files]}

    def get_project_preview(self, request: dict[str, str]) -> dict[str, object]:
        """读取工程预览信息，供打开工程页展示摘要。"""

        path = str(request.get("path", ""))
        preview = self.project_manager.get_project_preview(path)
        return {"preview": ProjectPreviewPayload.from_dict(preview).to_dict()}

    def apply_prefilter(self, request: dict[str, Any]) -> dict[str, object]:
        """持久化 TS 端预过滤后的最终条目与镜像 meta。"""

        items_raw = request.get("items", [])
        item_payloads = (
            [dict(item) for item in items_raw if isinstance(item, dict)]
            if isinstance(items_raw, list)
            else []
        )
        translation_extras_raw = request.get("translation_extras", {})
        translation_extras = (
            dict(translation_extras_raw)
            if isinstance(translation_extras_raw, dict)
            else {}
        )
        prefilter_config_raw = request.get("prefilter_config", {})
        prefilter_config = (
            dict(prefilter_config_raw) if isinstance(prefilter_config_raw, dict) else {}
        )
        expected_section_revisions_raw = request.get(
            "expected_section_revisions",
            {},
        )
        expected_section_revisions = (
            {
                str(section): int(revision)
                for section, revision in expected_section_revisions_raw.items()
                if isinstance(section, str)
            }
            if isinstance(expected_section_revisions_raw, dict)
            else None
        )
        self.project_manager.apply_prefilter_payload(
            item_payloads=item_payloads,
            translation_extras=translation_extras,
            project_status=str(request.get("project_status", "NONE") or "NONE"),
            prefilter_config=prefilter_config,
            expected_section_revisions=expected_section_revisions,
        )
        return self.runtime_service.build_project_mutation_ack(["items", "analysis"])

    def sync_project_settings_meta(self, request: dict[str, Any]) -> dict[str, object]:
        """把当前设置里的项目镜像字段写回 .lg。"""

        self.project_manager.sync_project_settings_meta(
            source_language=str(request.get("source_language", "") or ""),
            target_language=str(request.get("target_language", "") or ""),
        )
        return {"accepted": True}

    def import_analysis_glossary(self, request: dict[str, Any]) -> dict[str, object]:
        """持久化 TS 端已经筛好的分析候选导入结果。"""

        expected_section_revisions_raw = request.get(
            "expected_section_revisions",
            {},
        )
        if (
            isinstance(expected_section_revisions_raw, dict)
            and "analysis" in expected_section_revisions_raw
        ):
            self.project_manager.assert_project_runtime_section_revision(
                "analysis",
                int(expected_section_revisions_raw["analysis"]),
            )

        entries_raw = request.get("entries", [])
        entries = (
            [dict(entry) for entry in entries_raw if isinstance(entry, dict)]
            if isinstance(entries_raw, list)
            else []
        )
        quality_expected_revision = 0
        if (
            isinstance(expected_section_revisions_raw, dict)
            and "quality" in expected_section_revisions_raw
        ):
            quality_expected_revision = int(expected_section_revisions_raw["quality"])
        self.quality_rule_facade.save_entries(
            "glossary",
            expected_revision=quality_expected_revision,
            entries=entries,
        )
        self.project_manager.set_meta(
            "analysis_candidate_count",
            int(request.get("analysis_candidate_count", 0) or 0),
        )
        self.project_manager.bump_project_runtime_section_revisions(("analysis",))
        return self.runtime_service.build_project_mutation_ack(["quality", "analysis"])

    def build_project_snapshot(self, fallback_path: str = "") -> dict[str, object]:
        """所有工程类响应都通过这里生成，保持字段来源单一。"""

        project_path = ""
        get_lg_path = getattr(self.project_manager, "get_lg_path", None)
        if callable(get_lg_path):
            project_path = str(get_lg_path() or "")
        if project_path == "":
            project_path = fallback_path

        is_loaded = bool(self.project_manager.is_loaded())
        return ProjectSnapshotPayload(path=project_path, loaded=is_loaded).to_dict()
