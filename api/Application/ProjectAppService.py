from typing import Any

from base.BasePath import BasePath
from module.Config import Config
from module.Data.Core.Item import Item
from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService
from module.Engine.Engine import Engine
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.Data.Quality.QualityRuleFacadeService import QualityRuleFacadeService
from module.Utils.JSONTool import JSONTool
from api.Contract.ProjectPayloads import ProjectPreviewPayload
from api.Contract.ProjectPayloads import ProjectSnapshotPayload


class ProjectAppService:
    """工程用例层，负责把数据层调用收口为稳定响应载荷。"""

    def __init__(
        self,
        project_manager: Any | None = None,
        engine: Any | None = None,
        config_loader: Any | None = None,
        file_manager_factory: Any | None = None,
    ) -> None:
        self.project_manager = (
            project_manager if project_manager is not None else DataManager.get()
        )
        self.engine = engine if engine is not None else Engine.get()
        self.config_loader = (
            config_loader if config_loader is not None else lambda: Config().load()
        )
        self.file_manager_factory = (
            file_manager_factory
            if file_manager_factory is not None
            else lambda config: FileManager(config)
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

    def get_text_preserve_preset_rules(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        """读取文本保护预置规则，供 TS 侧执行页面派生转换。"""

        raw_text_types = request.get("text_types", [])
        text_types = raw_text_types if isinstance(raw_text_types, list) else []
        rules: dict[str, list[str]] = {}
        for raw_text_type in text_types:
            try:
                text_type = Item.TextType(str(raw_text_type).upper())
            except ValueError:
                continue

            rules[text_type.value] = self.load_text_preserve_preset_rules(text_type)
        return {"rules": rules}

    def export_converted_translation(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        """导出 TS 侧已完成简繁转换的条目，不写回工程运行态。"""

        is_loaded = getattr(self.project_manager, "is_loaded", None)
        if not callable(is_loaded) or not is_loaded():
            raise ValueError(Localizer.get().alert_project_not_loaded)

        suffix = str(request.get("suffix", "") or "")
        if suffix not in ("_S2T", "_T2S"):
            raise ValueError(Localizer.get().alert_invalid_export_data)

        converted_items_raw = request.get("items", [])
        converted_items = (
            [dict(item) for item in converted_items_raw if isinstance(item, dict)]
            if isinstance(converted_items_raw, list)
            else []
        )
        if len(converted_items) == 0:
            raise ValueError(Localizer.get().alert_no_data)

        current_items = self.project_manager.get_items_all()
        if len(current_items) == 0:
            raise ValueError(Localizer.get().alert_no_data)

        converted_item_by_id = self.build_converted_item_map(converted_items)
        export_items = [
            self.apply_converted_item_payload(item, converted_item_by_id)
            for item in current_items
        ]

        with self.project_manager.export_custom_suffix_context(suffix):
            output_path = self.file_manager_factory(self.config_loader()).write_to_path(
                export_items
            )

        if str(output_path).strip() == "":
            raise RuntimeError(Localizer.get().export_translation_failed)
        return {"accepted": True, "output_path": str(output_path)}

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

    def preview_translation_reset(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        mode = str(request.get("mode", "") or "").lower()
        if mode != "all":
            raise ValueError("translation reset preview 仅支持 mode=all")

        self.ensure_translation_mutation_ready()
        items = self.project_manager.preview_translation_reset_all(self.config_loader())
        return {"items": [dict(item) for item in items]}

    def apply_translation_reset(self, request: dict[str, Any]) -> dict[str, object]:
        mode = str(request.get("mode", "") or "").lower()
        self.ensure_translation_mutation_ready()

        expected_section_revisions = self.normalize_expected_section_revisions(
            request.get("expected_section_revisions")
        )
        if mode == "all":
            items_raw = request.get("items", [])
            item_payloads = (
                [dict(item) for item in items_raw if isinstance(item, dict)]
                if isinstance(items_raw, list)
                else []
            )
            translation_extras = self.normalize_dict_payload(
                request.get("translation_extras")
            )
            prefilter_config = self.normalize_dict_payload(
                request.get("prefilter_config")
            )
            self.project_manager.apply_translation_reset_all_payload(
                item_payloads=item_payloads,
                translation_extras=translation_extras,
                project_status=str(request.get("project_status", "NONE") or "NONE"),
                prefilter_config=prefilter_config,
                expected_section_revisions=expected_section_revisions,
            )
            return self.runtime_service.build_project_mutation_ack(
                ["items", "analysis"]
            )

        if mode == "failed":
            items_raw = request.get("items", [])
            item_payloads = (
                [dict(item) for item in items_raw if isinstance(item, dict)]
                if isinstance(items_raw, list)
                else []
            )
            translation_extras = self.normalize_dict_payload(
                request.get("translation_extras")
            )
            self.project_manager.apply_translation_reset_failed_payload(
                item_payloads=item_payloads,
                translation_extras=translation_extras,
                project_status=str(request.get("project_status", "NONE") or "NONE"),
                expected_section_revisions=expected_section_revisions,
            )
            return self.runtime_service.build_project_mutation_ack(["items"])

        raise ValueError("translation reset 仅支持 mode=all 或 mode=failed")

    def preview_analysis_reset(self, request: dict[str, Any]) -> dict[str, object]:
        mode = str(request.get("mode", "") or "").lower()
        if mode != "failed":
            raise ValueError("analysis reset preview 仅支持 mode=failed")

        self.ensure_analysis_mutation_ready()
        return {"status_summary": self.project_manager.preview_analysis_reset_failed()}

    def apply_analysis_reset(self, request: dict[str, Any]) -> dict[str, object]:
        mode = str(request.get("mode", "") or "").lower()
        self.ensure_analysis_mutation_ready()

        analysis_extras = self.normalize_dict_payload(request.get("analysis_extras"))
        expected_section_revisions = self.normalize_expected_section_revisions(
            request.get("expected_section_revisions")
        )
        if mode == "all":
            self.project_manager.apply_analysis_reset_all_payload(
                analysis_extras=analysis_extras,
                expected_section_revisions=expected_section_revisions,
            )
            return self.runtime_service.build_project_mutation_ack(["analysis"])

        if mode == "failed":
            self.project_manager.apply_analysis_reset_failed_payload(
                analysis_extras=analysis_extras,
                expected_section_revisions=expected_section_revisions,
            )
            return self.runtime_service.build_project_mutation_ack(["analysis"])

        raise ValueError("analysis reset 仅支持 mode=all 或 mode=failed")

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
        if (
            isinstance(expected_section_revisions_raw, dict)
            and "quality" in expected_section_revisions_raw
        ):
            current_quality_revision = int(
                self.runtime_service.get_section_revision("quality") or 0
            )
            expected_quality_revision = int(
                expected_section_revisions_raw["quality"] or 0
            )
            if current_quality_revision != expected_quality_revision:
                raise ValueError(
                    "质量规则 section revision 冲突："
                    f"当前={current_quality_revision}，"
                    f"期望={expected_quality_revision}"
                )

        entries_raw = request.get("entries", [])
        entries = (
            [dict(entry) for entry in entries_raw if isinstance(entry, dict)]
            if isinstance(entries_raw, list)
            else []
        )
        glossary_expected_revision = int(
            request.get("expected_glossary_revision", 0) or 0
        )
        self.quality_rule_facade.save_entries(
            "glossary",
            expected_revision=glossary_expected_revision,
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

    def load_text_preserve_preset_rules(self, text_type: Item.TextType) -> list[str]:
        path = (
            f"{BasePath.get_text_preserve_preset_dir()}/{text_type.value.lower()}.json"
        )
        try:
            raw_entries = JSONTool.load_file(path)
        except Exception:
            # 不是每个文本类型都有预置保护规则，缺失时按空规则交给 TS 侧处理。
            return []

        if not isinstance(raw_entries, list):
            return []

        rules: list[str] = []
        for entry in raw_entries:
            if not isinstance(entry, dict):
                continue
            src = entry.get("src", "")
            if isinstance(src, str) and src.strip():
                rules.append(src.strip())
        return rules

    def build_converted_item_map(
        self,
        converted_items: list[dict[str, Any]],
    ) -> dict[int, dict[str, Any]]:
        item_by_id: dict[int, dict[str, Any]] = {}
        for converted_item in converted_items:
            raw_item_id = converted_item.get("item_id", converted_item.get("id"))
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue

            item_by_id[item_id] = dict(converted_item)
        return item_by_id

    def apply_converted_item_payload(
        self,
        item: Item,
        converted_item_by_id: dict[int, dict[str, Any]],
    ) -> Item:
        item_id = item.get_id()
        export_item = Item.from_dict(item.to_dict())
        if item_id is None:
            return export_item

        converted_item = converted_item_by_id.get(int(item_id))
        if converted_item is None:
            return export_item

        export_item.set_dst(str(converted_item.get("dst", export_item.get_dst()) or ""))
        if "name_dst" in converted_item:
            export_item.set_name_dst(
                self.normalize_name_dst_payload(converted_item.get("name_dst"))
            )
        return export_item

    def normalize_name_dst_payload(self, value: Any) -> str | list[str] | None:
        if value is None:
            return None
        if isinstance(value, list):
            return [str(name) for name in value]
        return str(value)

    def ensure_analysis_mutation_ready(self) -> str:
        """分析 reset preview/apply 共用的前置校验。"""

        if bool(getattr(self.engine, "is_busy", lambda: False)()):
            raise ValueError(Localizer.get().task_running)

        is_loaded = getattr(self.project_manager, "is_loaded", None)
        get_lg_path = getattr(self.project_manager, "get_lg_path", None)
        if not callable(is_loaded) or not callable(get_lg_path) or not is_loaded():
            raise ValueError(Localizer.get().alert_project_not_loaded)

        lg_path = str(get_lg_path() or "")
        if lg_path == "":
            raise ValueError(Localizer.get().alert_project_not_loaded)
        return lg_path

    def ensure_translation_mutation_ready(self) -> str:
        """翻译 reset preview/apply 共用的前置校验。"""

        return self.ensure_analysis_mutation_ready()

    def normalize_dict_payload(self, value: Any) -> dict[str, Any]:
        return dict(value) if isinstance(value, dict) else {}

    def normalize_expected_section_revisions(
        self,
        value: Any,
    ) -> dict[str, int] | None:
        if not isinstance(value, dict):
            return None

        normalized: dict[str, int] = {}
        for section, revision in value.items():
            if not isinstance(section, str):
                continue
            try:
                normalized[section] = int(revision)
            except TypeError:
                continue
            except ValueError:
                continue
        return normalized
