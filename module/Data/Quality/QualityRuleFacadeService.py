from __future__ import annotations

from pathlib import Path
from typing import Any

from module.Data.Quality.PromptService import PromptService
from module.Data.Quality.QualityRuleMutationService import QualityRuleMutationService
from module.Data.Quality.QualityRulePresetService import QualityRulePresetService
from module.Data.Quality.QualityRuleSnapshotService import (
    QualityRuleSnapshotService,
)
from module.QualityRule.QualityRuleIO import QualityRuleIO


class QualityRuleFacadeService:
    """质量规则核心门面服务。

    这个门面把快照、写入、预设与提示词四类能力聚合到一起，
    方便 UI 以后只依赖一个入口而不直接碰底层服务。
    """

    def __init__(
        self,
        quality_rule_service: Any,
        meta_service: Any,
    ) -> None:
        self.quality_rule_service = quality_rule_service
        self.meta_service = meta_service
        self.snapshot_service = QualityRuleSnapshotService(
            quality_rule_service,
            meta_service,
        )
        self.mutation_service = QualityRuleMutationService(
            quality_rule_service,
            meta_service,
            self.snapshot_service,
        )
        self.preset_service = QualityRulePresetService()
        self.prompt_service = PromptService(quality_rule_service, meta_service)

    def get_rule_snapshot(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
    ) -> dict[str, object]:
        """对外暴露规则快照读取。"""

        return self.snapshot_service.get_rule_snapshot(rule_type)

    def list_presets(
        self,
        preset_dir_name: str,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        """对外暴露质量规则预设列表。"""

        return self.preset_service.list_presets(preset_dir_name)

    def read_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> list[dict[str, object]]:
        """对外暴露质量规则预设读取。"""

        return self.preset_service.read_preset(preset_dir_name, virtual_id)

    def save_user_preset(
        self,
        preset_dir_name: str,
        name: str,
        data: list[dict[str, Any]],
    ) -> dict[str, str]:
        """对外暴露质量规则用户预设保存。"""

        return self.preset_service.save_user_preset(preset_dir_name, name, data)

    def rename_user_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        """对外暴露质量规则用户预设重命名。"""

        return self.preset_service.rename_user_preset(
            preset_dir_name,
            virtual_id,
            new_name,
        )

    def delete_user_preset(
        self,
        preset_dir_name: str,
        virtual_id: str,
    ) -> str:
        """对外暴露质量规则用户预设删除。"""

        return self.preset_service.delete_user_preset(preset_dir_name, virtual_id)

    def save_entries(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        entries: list[dict[str, Any]],
    ) -> dict[str, object]:
        """对外暴露规则列表保存。"""

        return self.mutation_service.save_entries(
            rule_type,
            expected_revision=expected_revision,
            entries=entries,
        )

    def import_rules(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        path: str,
        *,
        expected_revision: int = 0,
    ) -> list[dict[str, Any]]:
        """对外暴露规则文件导入读取。"""

        del rule_type
        del expected_revision
        return QualityRuleIO.load_rules_from_file(path)

    def export_rules(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        path: str,
        entries: list[dict[str, Any]],
    ) -> str:
        """对外暴露规则文件导出。"""

        del rule_type
        QualityRuleIO.export_rules(str(Path(path).with_suffix("")), entries)
        return str(Path(path).with_suffix(".json")).replace("\\", "/")

    def delete_entry(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        index: int,
    ) -> dict[str, object]:
        """对外暴露规则条目删除。"""

        return self.mutation_service.delete_entry(
            rule_type,
            expected_revision=expected_revision,
            index=index,
        )

    def sort_entries(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        reverse: bool = False,
    ) -> dict[str, object]:
        """对外暴露规则条目排序。"""

        return self.mutation_service.sort_entries(
            rule_type,
            expected_revision=expected_revision,
            reverse=reverse,
        )

    def set_rule_enabled(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        enabled: bool,
    ) -> dict[str, object]:
        """对外暴露规则启用状态切换。"""

        return self.mutation_service.set_rule_enabled(
            rule_type,
            expected_revision=expected_revision,
            enabled=enabled,
        )

    def update_meta(
        self,
        rule_type: str | QualityRuleSnapshotService.RuleType,
        *,
        expected_revision: int,
        meta_key: str,
        value: Any,
    ) -> dict[str, object]:
        """对外暴露规则 meta 更新。"""

        return self.mutation_service.update_meta(
            rule_type,
            expected_revision=expected_revision,
            meta_key=meta_key,
            value=value,
        )

    def get_prompt_snapshot(
        self,
        task_type: str,
    ) -> dict[str, object]:
        """对外暴露提示词快照。"""

        return self.prompt_service.get_prompt_snapshot(task_type)

    def get_default_preset_text(self, task_type: str, virtual_id: str) -> str:
        """对外暴露提示词默认预设读取。"""

        return self.prompt_service.get_default_preset_text(task_type, virtual_id)

    def list_prompt_presets(
        self,
        task_type: str,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        """对外暴露提示词预设列表。"""

        return self.prompt_service.list_presets(task_type)

    def read_prompt_preset(
        self,
        task_type: str,
        virtual_id: str,
    ) -> str:
        """对外暴露提示词预设读取。"""

        return self.prompt_service.read_preset(task_type, virtual_id)

    def save_prompt_preset(
        self,
        task_type: str,
        name: str,
        text: str,
    ) -> str:
        """对外暴露提示词预设保存。"""

        return self.prompt_service.save_user_preset(task_type, name, text)

    def rename_prompt_preset(
        self,
        task_type: str,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        """对外暴露提示词预设重命名。"""

        return self.prompt_service.rename_user_preset(task_type, virtual_id, new_name)

    def delete_prompt_preset(
        self,
        task_type: str,
        virtual_id: str,
    ) -> str:
        """对外暴露提示词预设删除。"""

        return self.prompt_service.delete_user_preset(task_type, virtual_id)

    def save_prompt(
        self,
        task_type: str,
        *,
        expected_revision: int,
        text: str,
        enabled: bool | None = None,
    ) -> dict[str, object]:
        """对外暴露提示词保存。"""

        return self.prompt_service.save_prompt(
            task_type,
            expected_revision=expected_revision,
            text=text,
            enabled=enabled,
        )

    def export_prompt(self, task_type: str, path: str) -> str:
        """对外暴露提示词导出。"""

        return self.prompt_service.export_prompt(task_type, path)

    def read_prompt_import_text(
        self,
        task_type: str,
        path: str,
    ) -> str:
        """对外暴露提示词导入文本读取。"""

        return self.prompt_service.read_prompt_import_text(
            task_type,
            path,
        )
