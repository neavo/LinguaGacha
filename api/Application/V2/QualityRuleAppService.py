from __future__ import annotations

from typing import Any

from api.Application.QualityRuleAppService import QualityRuleAppService


class V2QualityRuleAppService:
    """V2 质量规则路由的薄包装层，复用现有规则与提示词用例实现。"""

    def __init__(
        self,
        quality_rule_app_service: QualityRuleAppService | None = None,
    ) -> None:
        self.quality_rule_app_service = (
            quality_rule_app_service
            if quality_rule_app_service is not None
            else QualityRuleAppService()
        )

    def get_rule_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.get_rule_snapshot(request)

    def update_rule_meta(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.update_rule_meta(request)

    def save_rule_entries(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.save_rule_entries(request)

    def import_rules(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.import_rules(request)

    def export_rules(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.export_rules(request)

    def list_rule_presets(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.list_rule_presets(request)

    def read_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.read_rule_preset(request)

    def save_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.save_rule_preset(request)

    def rename_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.rename_rule_preset(request)

    def delete_rule_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.delete_rule_preset(request)

    def query_proofreading(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.query_proofreading(request)

    def build_rule_statistics(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.build_rule_statistics(request)

    def get_prompt_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.get_prompt_snapshot(request)

    def get_prompt_template(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.get_prompt_template(request)

    def save_prompt(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.save_prompt(request)

    def import_prompt(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.import_prompt(request)

    def export_prompt(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.export_prompt(request)

    def list_prompt_presets(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.list_prompt_presets(request)

    def read_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.read_prompt_preset(request)

    def save_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.save_prompt_preset(request)

    def rename_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.rename_prompt_preset(request)

    def delete_prompt_preset(self, request: dict[str, Any]) -> dict[str, object]:
        return self.quality_rule_app_service.delete_prompt_preset(request)
