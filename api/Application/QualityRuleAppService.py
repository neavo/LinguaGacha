from __future__ import annotations

from typing import Any

from api.Contract.QualityPayloads import ProofreadingLookupPayload
from api.Contract.QualityPayloads import QualityRuleSnapshotPayload
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleStatisticsSnapshot
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.Quality.QualityRuleFacadeService import QualityRuleFacadeService
from module.Data.Quality.QualityRuleMutationService import QualityRuleMutationService
from module.PromptBuilder import PromptBuilder
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics


class QualityRuleAppService:
    """质量规则用例层，负责把 Core 结果映射成稳定 API 载荷。"""

    def __init__(self, quality_rule_facade: Any | None = None) -> None:
        self.data_manager = DataManager.get()
        if quality_rule_facade is None:
            self.quality_rule_facade = QualityRuleFacadeService(
                self.data_manager,
                self.data_manager,
            )
        else:
            self.quality_rule_facade = quality_rule_facade

    def get_rule_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        """读取规则快照，并统一通过 payload 输出。"""

        rule_type = str(request.get("rule_type", ""))
        snapshot = self.quality_rule_facade.get_rule_snapshot(rule_type)
        return QualityRuleSnapshotPayload.from_dict(snapshot).to_dict()

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

        snapshot = self.quality_rule_facade.save_entries(
            rule_type,
            expected_revision=expected_revision,
            entries=entries,
        )
        return QualityRuleSnapshotPayload.from_dict(snapshot).to_dict()

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

        if snapshot is None:
            snapshot = self.quality_rule_facade.get_rule_snapshot(rule_type)
        return QualityRuleSnapshotPayload.from_dict(snapshot).to_dict()

    def query_proofreading(self, request: dict[str, Any]) -> dict[str, object]:
        """把质量规则条目转换成校对页可直接消费的查询参数。"""

        rule_type = str(request.get("rule_type", ""))
        entry_raw = request.get("entry", {})
        if isinstance(entry_raw, dict):
            keyword = str(entry_raw.get("src", "")).strip()
            if rule_type == "text_preserve":
                is_regex = True
            else:
                is_regex = bool(entry_raw.get("regex", False))
        else:
            keyword = ""
            if rule_type == "text_preserve":
                is_regex = True
            else:
                is_regex = bool(request.get("is_regex", False))

        query = ProofreadingLookupQuery(keyword=keyword, is_regex=is_regex)
        return ProofreadingLookupPayload(query=query).to_dict()

    def build_rule_statistics(self, request: dict[str, Any]) -> dict[str, object]:
        """构建质量规则统计快照。"""

        rules_raw = request.get("rules", [])
        rules: list[QualityRuleStatistics.RuleStatInput] = []
        if isinstance(rules_raw, list):
            for rule in rules_raw:
                if not isinstance(rule, dict):
                    continue
                rules.append(
                    QualityRuleStatistics.RuleStatInput(
                        key=str(rule.get("key", "")),
                        pattern=str(rule.get("pattern", "")),
                        mode=QualityRuleStatistics.RuleStatMode(
                            str(rule.get("mode", "glossary"))
                        ),
                        regex=bool(rule.get("regex", False)),
                        case_sensitive=bool(rule.get("case_sensitive", False)),
                    )
                )

        relation_candidates_raw = request.get("relation_candidates", [])
        relation_candidates: tuple[tuple[str, str], ...] = tuple(
            (
                str(candidate.get("key", "")),
                str(candidate.get("src", "")),
            )
            for candidate in relation_candidates_raw
            if isinstance(candidate, dict)
        )

        src_texts, dst_texts = self.data_manager.collect_rule_statistics_texts()
        snapshot = QualityRuleStatistics.build_rule_statistics_snapshot(
            rules=tuple(rules),
            src_texts=src_texts,
            dst_texts=dst_texts,
            relation_candidates=relation_candidates,
        )
        payload = QualityRuleStatisticsSnapshot.from_dict(
            {
                "available": True,
                "results": {
                    key: {
                        "matched_item_count": result.matched_item_count,
                        "subset_parents": list(snapshot.subset_parents.get(key, ())),
                    }
                    for key, result in snapshot.results.items()
                },
            }
        )
        return {"statistics": payload.to_dict()}

    def get_prompt_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        """读取指定任务类型的提示词快照。"""

        task_type = str(request.get("task_type", ""))
        snapshot = self.quality_rule_facade.get_prompt_snapshot(task_type)
        return {"prompt": snapshot}

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

        snapshot = self.quality_rule_facade.save_prompt(
            task_type,
            expected_revision=expected_revision,
            text=text,
            enabled=enabled,
        )
        return {"prompt": snapshot}

    def import_prompt(self, request: dict[str, Any]) -> dict[str, object]:
        """从本地路径导入提示词。"""

        task_type = str(request.get("task_type", ""))
        expected_revision = int(request.get("expected_revision", 0) or 0)
        path = str(request.get("path", ""))
        enabled_raw = request.get("enabled")
        enabled: bool | None
        if enabled_raw is None:
            enabled = None
        else:
            enabled = bool(enabled_raw)

        snapshot = self.quality_rule_facade.import_prompt(
            task_type,
            path,
            expected_revision=expected_revision,
            enabled=enabled,
        )
        return {"prompt": snapshot}

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
