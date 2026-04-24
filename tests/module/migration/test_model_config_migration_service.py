from module.Migration.ModelConfigMigrationService import ModelConfigMigrationService
from module.Model.Types import ModelType


def build_model_data(
    model_id: str,
    type_value: str,
    api_format: str = "OpenAI",
) -> dict:
    return {
        "id": model_id,
        "type": type_value,
        "name": model_id,
        "api_format": api_format,
        "api_url": "https://example.com",
        "api_key": "k",
        "model_id": "m",
    }


def test_migrate_legacy_preset_models_reclassifies_missing_preset_ids() -> None:
    models = [
        build_model_data("old-google", ModelType.PRESET.value, "Google"),
        build_model_data("old-anthropic", ModelType.PRESET.value, "Anthropic"),
        build_model_data("old-other", ModelType.PRESET.value, "SakuraLLM"),
        build_model_data("preset-current", ModelType.PRESET.value, "Google"),
        build_model_data("custom", ModelType.CUSTOM_OPENAI.value, "OpenAI"),
    ]

    migrated_count = ModelConfigMigrationService.migrate_legacy_preset_models(
        models,
        {"preset-current"},
    )

    assert migrated_count == 3
    assert models[0]["type"] == ModelType.CUSTOM_GOOGLE.value
    assert models[1]["type"] == ModelType.CUSTOM_ANTHROPIC.value
    assert models[2]["type"] == ModelType.CUSTOM_OPENAI.value
    assert models[3]["type"] == ModelType.PRESET.value
    assert models[4]["type"] == ModelType.CUSTOM_OPENAI.value


def test_migrate_legacy_preset_models_reports_zero_when_all_presets_are_current() -> (
    None
):
    models = [build_model_data("preset-current", ModelType.PRESET.value, "Google")]

    migrated_count = ModelConfigMigrationService.migrate_legacy_preset_models(
        models,
        {"preset-current"},
    )

    assert migrated_count == 0
    assert models[0]["type"] == ModelType.PRESET.value
