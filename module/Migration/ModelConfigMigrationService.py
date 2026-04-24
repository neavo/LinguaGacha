from __future__ import annotations

from module.Model.Types import ModelType


class ModelConfigMigrationService:
    """统一承接模型配置旧分类向当前分类的迁移。"""

    @classmethod
    def migrate_legacy_preset_models(
        cls,
        existing_models: list[dict],
        preset_ids: set[object],
    ) -> int:
        """把已从内置预设中移除的旧 PRESET 模型迁移成自定义模型。"""

        migrated_count = 0
        for model in existing_models:
            if (
                model.get("type") == ModelType.PRESET.value
                and model.get("id") not in preset_ids
            ):
                migrated_type = cls.resolve_custom_model_type(
                    str(model.get("api_format", ""))
                )
                model["type"] = migrated_type.value
                migrated_count += 1

        return migrated_count

    @classmethod
    def resolve_custom_model_type(cls, api_format: str) -> ModelType:
        """旧预设模型迁移时统一按 api_format 归类。"""

        if api_format == "Google":
            return ModelType.CUSTOM_GOOGLE
        if api_format == "Anthropic":
            return ModelType.CUSTOM_ANTHROPIC
        return ModelType.CUSTOM_OPENAI
