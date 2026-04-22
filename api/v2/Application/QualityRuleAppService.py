from __future__ import annotations

from typing import Any

from base.Base import Base
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.Project.ProjectRuntimeService import ProjectRuntimeService
from module.Data.Quality.QualityRuleFacadeService import QualityRuleFacadeService
from module.Data.Quality.QualityRuleMutationService import QualityRuleMutationService
from module.PromptBuilder import PromptBuilder


class QualityRuleAppService:
    """质量规则用例层，负责把 Core 结果映射成稳定 API 载荷。"""

    def __init__(
        self,
        quality_rule_facade: Any | None = None,
        runtime_service: ProjectRuntimeService | None = None,
        event_emitter: Any | None = None,
    ) -> None:
        self.data_manager = DataManager.get()
        self.runtime_service = (
            runtime_service
            if runtime_service is not None
            else ProjectRuntimeService(self.data_manager)
        )
        self.event_emitter = event_emitter if event_emitter is not None else Base().emit
        if quality_rule_facade is None:
            quality_rule_service = getattr(
                self.data_manager,
                "quality_rule_service",
                self.data_manager,
            )
            meta_service = getattr(
                self.data_manager,
                "meta_service",
                self.data_manager,
            )
            self.quality_rule_facade = QualityRuleFacadeService(
                quality_rule_service,
                meta_service,
            )
        else:
            self.quality_rule_facade = quality_rule_facade

    def save_rule_entries(self, request: dict[str, Any]) -> dict[str, object]:
        """保存完整规则条目列表。"""

        rule_type = str(request.get("rule_type", ""))
        expected_revision = int(request.get("expected_revision", 0) or 0)
        entries_raw = request.get("entries", [])
        entries: list[dict[str, Any]] = []
        if isinstance(entries_raw, list):
            for entry in entries_raw:
                if isinstance(entry, dict):
                    entries.append(dict(entry))

        self.quality_rule_facade.save_entries(
            rule_type,
            expected_revision=expected_revision,
            entries=entries,
        )
        self.emit_quality_patch("quality_rule_save")
        return {"accepted": True}

    def import_rules(self, request: dict[str, Any]) -> dict[str, object]:
        """从本地路径读取规则条目，返回给页面做后续合并。"""

        rule_type = str(request.get("rule_type", ""))
        path = str(request.get("path", ""))
        expected_revision = int(request.get("expected_revision", 0) or 0)
        entries = self.quality_rule_facade.import_rules(
            rule_type,
            path,
            expected_revision=expected_revision,
        )
        return {"entries": entries}

    def export_rules(self, request: dict[str, Any]) -> dict[str, object]:
        """把页面当前规则条目导出到本地路径。"""

        rule_type = str(request.get("rule_type", ""))
        path = str(request.get("path", ""))
        entries_raw = request.get("entries", [])
        entries: list[dict[str, Any]] = []
        if isinstance(entries_raw, list):
            for entry in entries_raw:
                if isinstance(entry, dict):
                    entries.append(dict(entry))

        exported_path = self.quality_rule_facade.export_rules(rule_type, path, entries)
        return {"path": exported_path}

    def list_rule_presets(self, request: dict[str, Any]) -> dict[str, object]:
        """列出质量规则预设。"""

        preset_dir_name = str(request.get("preset_dir_name", ""))
        builtin_presets, user_presets = self.quality_rule_facade.list_presets(
            preset_dir_name
        )
        return {
            "builtin_presets": builtin_presets,
            "user_presets": user_presets,
        }

    def read_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """读取质量规则预设正文。"""

        preset_dir_name = str(request.get("preset_dir_name", ""))
        virtual_id = str(request.get("virtual_id", ""))
        entries = self.quality_rule_facade.read_preset(preset_dir_name, virtual_id)
        return {"entries": entries}

    def save_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """保存质量规则用户预设。"""

        preset_dir_name = str(request.get("preset_dir_name", ""))
        name = str(request.get("name", ""))
        entries_raw = request.get("entries", [])
        entries: list[dict[str, Any]] = []
        if isinstance(entries_raw, list):
            for entry in entries_raw:
                if isinstance(entry, dict):
                    entries.append(dict(entry))

        item = self.quality_rule_facade.save_user_preset(
            preset_dir_name,
            name,
            entries,
        )
        return {"item": item}

    def rename_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """重命名质量规则用户预设。"""

        preset_dir_name = str(request.get("preset_dir_name", ""))
        virtual_id = str(request.get("virtual_id", ""))
        new_name = str(request.get("new_name", ""))
        item = self.quality_rule_facade.rename_user_preset(
            preset_dir_name,
            virtual_id,
            new_name,
        )
        return {"item": item}

    def delete_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """删除质量规则用户预设。"""

        preset_dir_name = str(request.get("preset_dir_name", ""))
        virtual_id = str(request.get("virtual_id", ""))
        path = self.quality_rule_facade.delete_user_preset(preset_dir_name, virtual_id)
        return {"path": path}

    def update_rule_meta(self, request: dict[str, Any]) -> dict[str, object]:
        """更新规则 meta，并把 enabled 与普通 meta 写入统一收口。"""

        rule_type = str(request.get("rule_type", ""))
        current_revision = int(request.get("expected_revision", 0) or 0)
        meta_raw = request.get("meta", {})
        if isinstance(meta_raw, dict):
            meta = dict(meta_raw)
        else:
            meta = {}

        snapshot: dict[str, Any] | None = None
        for meta_key, value in meta.items():
            resolved_meta_key = str(meta_key)
            if rule_type == "text_preserve" and resolved_meta_key == "mode":
                resolved_meta_key = (
                    QualityRuleMutationService.TEXT_PRESERVE_MODE_META_KEY
                )

            if meta_key == "enabled":
                snapshot = self.quality_rule_facade.set_rule_enabled(
                    rule_type,
                    expected_revision=current_revision,
                    enabled=bool(value),
                )
            else:
                snapshot = self.quality_rule_facade.update_meta(
                    rule_type,
                    expected_revision=current_revision,
                    meta_key=resolved_meta_key,
                    value=value,
                )

            revision_raw = snapshot.get("revision", current_revision)
            current_revision = int(revision_raw or current_revision)

        if snapshot is not None:
            self.emit_quality_patch("quality_rule_meta")
        return {"accepted": True}

    def get_prompt_template(self, request: dict[str, Any]) -> dict[str, object]:
        """读取提示词编辑页所需的模板文本。"""

        task_type = str(request.get("task_type", ""))
        builder = PromptBuilder(Config().load())
        language = builder.get_prompt_ui_language()
        if task_type == "translation":
            default_text = builder.get_base(language)
            prefix_text = builder.get_prefix(language)
            suffix_text = builder.get_suffix(language)
        else:
            default_text = builder.get_analysis_base(language)
            prefix_text = builder.get_analysis_prefix(language)
            suffix_text = builder.get_analysis_suffix(language)

        return {
            "template": {
                "default_text": default_text,
                "prefix_text": prefix_text,
                "suffix_text": suffix_text,
            }
        }

    def save_prompt(self, request: dict[str, Any]) -> dict[str, object]:
        """保存提示词正文与启用状态。"""

        task_type = str(request.get("task_type", ""))
        expected_revision = int(request.get("expected_revision", 0) or 0)
        text = str(request.get("text", ""))
        enabled_raw = request.get("enabled")
        enabled: bool | None
        if enabled_raw is None:
            enabled = None
        else:
            enabled = bool(enabled_raw)

        self.quality_rule_facade.save_prompt(
            task_type,
            expected_revision=expected_revision,
            text=text,
            enabled=enabled,
        )
        self.emit_prompts_patch("quality_prompt_save")
        return {"accepted": True}

    def read_prompt_import_text(self, request: dict[str, Any]) -> dict[str, object]:
        """从本地路径读取提示词文本，不直接写入项目状态。"""

        task_type = str(request.get("task_type", ""))
        path = str(request.get("path", ""))
        text = self.quality_rule_facade.read_prompt_import_text(task_type, path)
        return {"text": text}

    def export_prompt(self, request: dict[str, Any]) -> dict[str, object]:
        """导出提示词到本地路径。"""

        task_type = str(request.get("task_type", ""))
        path = str(request.get("path", ""))
        exported_path = self.quality_rule_facade.export_prompt(task_type, path)
        return {"path": exported_path}

    def list_prompt_presets(self, request: dict[str, Any]) -> dict[str, object]:
        """列出提示词预设。"""

        task_type = str(request.get("task_type", ""))
        builtin_presets, user_presets = self.quality_rule_facade.list_prompt_presets(
            task_type
        )
        return {
            "builtin_presets": builtin_presets,
            "user_presets": user_presets,
        }

    def read_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """读取提示词预设正文。"""

        task_type = str(request.get("task_type", ""))
        virtual_id = str(request.get("virtual_id", ""))
        text = self.quality_rule_facade.read_prompt_preset(task_type, virtual_id)
        return {"text": text}

    def save_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """保存提示词用户预设。"""

        task_type = str(request.get("task_type", ""))
        name = str(request.get("name", ""))
        text = str(request.get("text", ""))
        path = self.quality_rule_facade.save_prompt_preset(task_type, name, text)
        return {"path": path}

    def rename_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """重命名提示词用户预设。"""

        task_type = str(request.get("task_type", ""))
        virtual_id = str(request.get("virtual_id", ""))
        new_name = str(request.get("new_name", ""))
        item = self.quality_rule_facade.rename_prompt_preset(
            task_type,
            virtual_id,
            new_name,
        )
        return {"item": item}

    def delete_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        """删除提示词用户预设。"""

        task_type = str(request.get("task_type", ""))
        virtual_id = str(request.get("virtual_id", ""))
        path = self.quality_rule_facade.delete_prompt_preset(task_type, virtual_id)
        return {"path": path}

    def emit_quality_patch(self, reason: str) -> None:
        quality_block = self.runtime_service.build_quality_block()
        quality_revision = self.runtime_service.get_section_revision("quality")
        self.data_manager.emit_project_runtime_patch(
            reason=reason,
            updated_sections=("quality",),
            patch=[
                {
                    "op": "replace_quality",
                    "quality": quality_block,
                }
            ],
            section_revisions={"quality": quality_revision},
            project_revision=quality_revision,
        )

    def emit_prompts_patch(self, reason: str) -> None:
        prompts_block = self.runtime_service.build_prompts_block()
        prompts_revision = self.runtime_service.get_section_revision("prompts")
        self.data_manager.emit_project_runtime_patch(
            reason=reason,
            updated_sections=("prompts",),
            patch=[
                {
                    "op": "replace_prompts",
                    "prompts": prompts_block,
                }
            ],
            section_revisions={"prompts": prompts_revision},
            project_revision=prompts_revision,
        )
