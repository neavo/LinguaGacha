from typing import Any

from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService


class WorkbenchAppService:
    """工作台用例层，负责把文件操作与局部补丁收口为稳定响应载荷。"""

    def __init__(self, data_manager: Any | None = None) -> None:
        self.data_manager = (
            data_manager if data_manager is not None else DataManager.get()
        )

    def parse_expected_section_revisions(
        self,
        request: dict[str, Any],
    ) -> dict[str, int] | None:
        raw_expected_section_revisions = request.get("expected_section_revisions", {})
        if not isinstance(raw_expected_section_revisions, dict):
            return None

        return {
            str(section): int(revision)
            for section, revision in raw_expected_section_revisions.items()
            if isinstance(section, str)
        }

    def parse_derived_meta(
        self,
        request: dict[str, Any],
    ) -> tuple[dict[str, Any], str, dict[str, Any]]:
        raw_derived_meta = request.get("derived_meta", {})
        derived_meta = (
            dict(raw_derived_meta) if isinstance(raw_derived_meta, dict) else {}
        )
        translation_extras = derived_meta.get("translation_extras", {})
        prefilter_config = derived_meta.get("prefilter_config", {})
        return (
            dict(translation_extras) if isinstance(translation_extras, dict) else {},
            str(derived_meta.get("project_status", "NONE") or "NONE"),
            dict(prefilter_config) if isinstance(prefilter_config, dict) else {},
        )

    def build_project_mutation_ack(
        self,
        updated_sections: tuple[str, ...] | list[str],
    ) -> dict[str, object]:
        ack_builder = getattr(self.data_manager, "build_project_mutation_ack", None)
        if callable(ack_builder):
            return ack_builder(updated_sections)
        return ProjectRuntimeService(self.data_manager).build_project_mutation_ack(
            updated_sections
        )

    def parse_file(self, request: dict[str, Any]) -> dict[str, object]:
        """只读解析工作台文件，返回 TS planner 需要的标准化结果。"""

        source_path = str(request.get("source_path", ""))
        rel_path_raw = request.get("rel_path")
        current_rel_path = (
            str(rel_path_raw)
            if isinstance(rel_path_raw, str) and rel_path_raw
            else None
        )
        parse_preview = getattr(self.data_manager, "parse_file_preview", None)
        if callable(parse_preview):
            return parse_preview(
                source_path,
                current_rel_path=current_rel_path,
            )

        project_file_service = getattr(self.data_manager, "project_file_service", None)
        if project_file_service is None:
            raise AttributeError("缺少 project_file_service.parse_file_preview")
        return project_file_service.parse_file_preview(
            source_path,
            current_rel_path=current_rel_path,
        )

    def parse_add_file_entries(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        raw_files = request.get("files", [])
        if not isinstance(raw_files, list):
            return []

        entries: list[dict[str, Any]] = []
        for raw_file in raw_files:
            if not isinstance(raw_file, dict):
                continue

            raw_file_record = raw_file.get("file_record", {})
            file_record = (
                dict(raw_file_record) if isinstance(raw_file_record, dict) else {}
            )
            parsed_items_raw = raw_file.get("parsed_items", [])
            parsed_items = (
                [dict(item) for item in parsed_items_raw if isinstance(item, dict)]
                if isinstance(parsed_items_raw, list)
                else []
            )
            entries.append(
                {
                    "source_path": str(raw_file.get("source_path", "")),
                    "target_rel_path": str(raw_file.get("target_rel_path", "")),
                    "file_record": file_record,
                    "parsed_items": parsed_items,
                }
            )
        return entries

    def add_file_batch(self, request: dict[str, Any]) -> dict[str, object]:
        """批量执行新增文件操作，失败时直接把异常交给 HTTP 边界。"""

        files = self.parse_add_file_entries(request)
        translation_extras, project_status, prefilter_config = self.parse_derived_meta(
            request
        )
        self.data_manager.persist_add_files_payload(
            files,
            translation_extras=translation_extras,
            project_status=project_status,
            prefilter_config=prefilter_config,
            expected_section_revisions=self.parse_expected_section_revisions(request),
        )
        return self.build_project_mutation_ack(("files", "items", "analysis"))

    def reset_file(self, request: dict[str, Any]) -> dict[str, object]:
        """执行重置文件操作，失败时直接把异常交给 HTTP 边界。"""

        rel_path = str(request.get("rel_path", ""))
        items_raw = request.get("items", [])
        item_payloads = (
            [dict(item) for item in items_raw if isinstance(item, dict)]
            if isinstance(items_raw, list)
            else []
        )
        translation_extras, project_status, prefilter_config = self.parse_derived_meta(
            request
        )
        self.data_manager.persist_reset_file(
            rel_path,
            item_payloads=item_payloads,
            translation_extras=translation_extras,
            project_status=project_status,
            prefilter_config=prefilter_config,
            expected_section_revisions=self.parse_expected_section_revisions(request),
        )
        return self.build_project_mutation_ack(("items", "analysis"))

    def delete_file(self, request: dict[str, Any]) -> dict[str, object]:
        """执行删除文件操作，失败时直接把异常交给 HTTP 边界。"""

        rel_path = str(request.get("rel_path", ""))
        translation_extras, project_status, prefilter_config = self.parse_derived_meta(
            request
        )
        self.data_manager.persist_delete_files(
            [rel_path],
            translation_extras=translation_extras,
            project_status=project_status,
            prefilter_config=prefilter_config,
            expected_section_revisions=self.parse_expected_section_revisions(request),
        )
        return self.build_project_mutation_ack(("files", "items", "analysis"))

    def delete_file_batch(self, request: dict[str, Any]) -> dict[str, object]:
        """执行批量删除文件操作，失败时直接把异常交给 HTTP 边界。"""

        rel_paths_raw = request.get("rel_paths", [])
        rel_paths = (
            [str(rel_path) for rel_path in rel_paths_raw]
            if isinstance(rel_paths_raw, list)
            else []
        )
        translation_extras, project_status, prefilter_config = self.parse_derived_meta(
            request
        )
        self.data_manager.persist_delete_files(
            rel_paths,
            translation_extras=translation_extras,
            project_status=project_status,
            prefilter_config=prefilter_config,
            expected_section_revisions=self.parse_expected_section_revisions(request),
        )
        return self.build_project_mutation_ack(("files", "items", "analysis"))

    def reorder_files(self, request: dict[str, Any]) -> dict[str, object]:
        """按前端拖拽后的完整顺序持久化工作台文件列表。"""

        ordered_rel_paths_raw = request.get("ordered_rel_paths", [])
        ordered_rel_paths = (
            [str(rel_path) for rel_path in ordered_rel_paths_raw]
            if isinstance(ordered_rel_paths_raw, list)
            else []
        )
        self.data_manager.persist_reordered_files(
            ordered_rel_paths,
            expected_section_revisions=self.parse_expected_section_revisions(request),
        )
        return self.build_project_mutation_ack(("files",))
