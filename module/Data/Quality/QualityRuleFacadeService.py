from __future__ import annotations

from typing import Any

from module.Data.Quality.PromptService import PromptService
from module.Data.Quality.QualityRuleMutationService import QualityRuleMutationService
from module.Data.Quality.QualityRulePresetService import QualityRulePresetService
from module.Data.Quality.QualityRuleSnapshotService import (
    QualityRuleSnapshotService,
)


class QualityRuleFacadeService:
    """质量规则核心门面服务。

    这个门面把快照、写入、预设与提示词四类能力聚合到一起，
    方便 UI 以后只依赖一个入口而不直接碰底层服务。
    """

    def __init__(self, quality_rule_service: Any, meta_service: Any) -> None:
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

    def get_prompt_snapshot(
        self,
        task_type: str,
    ) -> dict[str, object]:
        """对外暴露提示词快照。"""

        return self.prompt_service.get_prompt_snapshot(task_type)

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

    def import_prompt(
        self,
        task_type: str,
        path: str,
        *,
        expected_revision: int,
        enabled: bool | None = None,
    ) -> dict[str, object]:
        """对外暴露提示词导入。"""

        return self.prompt_service.import_prompt(
            task_type,
            path,
            expected_revision=expected_revision,
            enabled=enabled,
        )
