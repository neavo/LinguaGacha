import inspect

import pytest

from api.Application.ExtraAppService import ExtraAppService
from api.Server.Routes.ExtraRoutes import ExtraRoutes
from module.Data.Extra.LaboratoryService import LaboratoryService
from module.Data.Extra.NameFieldExtractionService import NameFieldExtractionService
from module.Data.Extra.TsConversionService import TsConversionService
from tests.api.support.application_fakes import FakeSettingsConfig


class FakeNameFieldExtractionService:
    """为 Extra 应用服务测试提供稳定的姓名字段服务桩。"""

    def get_name_field_snapshot(self) -> dict[str, object]:
        return self.extract_name_fields()

    def extract_name_fields(self) -> dict[str, object]:
        return {
            "items": [
                {
                    "src": "勇者",
                    "dst": "",
                    "context": "勇者が来た",
                    "status": "未翻译",
                }
            ]
        }

    def translate_name_fields(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        del items
        return {
            "items": [
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "context": "勇者が来た",
                    "status": "翻译完成",
                }
            ],
            "success_count": 1,
            "failed_count": 0,
        }

    def save_name_fields_to_glossary(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        return {"items": items}


@pytest.fixture
def fake_config() -> FakeSettingsConfig:
    config = FakeSettingsConfig()
    config.mtool_optimizer_enable = False
    config.force_thinking_enable = True
    return config


@pytest.fixture
def extra_app_service(fake_config: FakeSettingsConfig) -> ExtraAppService:
    return ExtraAppService(
        laboratory_service=LaboratoryService(config_loader=lambda: fake_config),
        ts_conversion_service=TsConversionService(),
        name_field_extraction_service=FakeNameFieldExtractionService(),
    )


def test_extra_app_service_updates_laboratory_settings(
    fake_config: FakeSettingsConfig,
) -> None:
    from module.Data.Extra.LaboratoryService import LaboratoryService

    # Arrange
    service = ExtraAppService(
        laboratory_service=LaboratoryService(config_loader=lambda: fake_config)
    )

    # Act
    result = service.update_laboratory_settings({"mtool_optimizer_enabled": True})

    # Assert
    assert result["snapshot"]["mtool_optimizer_enabled"] is True


def test_extra_routes_register_requires_typed_extra_app_service() -> None:
    # Arrange
    signature = inspect.signature(ExtraRoutes.register)

    # Act
    parameter = signature.parameters["extra_app_service"]

    # Assert
    assert parameter.annotation is ExtraAppService


def test_start_ts_conversion_returns_task_payload(
    extra_app_service: ExtraAppService,
) -> None:
    # Arrange
    request = {
        "direction": "TO_SIMPLIFIED",
        "preserve_text": True,
        "convert_name": False,
    }

    # Act
    result = extra_app_service.start_ts_conversion(request)

    # Assert
    assert result["task"]["task_id"] == "extra_ts_conversion"
    assert result["task"]["accepted"] is True


def test_extra_app_service_get_name_field_snapshot_returns_snapshot_payload() -> None:
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.get_name_field_snapshot()

    # Assert
    assert result["snapshot"]["items"][0]["src"] == "勇者"
    assert result["snapshot"]["items"][0]["context"] == "勇者が来た"


def test_extra_app_service_translate_name_fields_returns_translate_payload() -> None:
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.translate_name_fields(
        {
            "items": [
                {
                    "src": "勇者",
                    "dst": "",
                    "context": "勇者が来た",
                    "status": "未翻译",
                }
            ]
        }
    )

    # Assert
    assert result["result"]["success_count"] == 1
    assert result["result"]["failed_count"] == 0
    assert result["result"]["items"][0]["dst"] == "Hero"


def test_extra_app_service_save_name_fields_to_glossary_returns_snapshot_payload() -> (
    None
):
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.save_name_fields_to_glossary(
        {
            "items": [
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "context": "勇者が来た",
                    "status": "翻译完成",
                }
            ]
        }
    )

    # Assert
    assert result["snapshot"]["items"][0]["src"] == "勇者"
    assert result["snapshot"]["items"][0]["dst"] == "Hero"


def test_extra_routes_register_requires_typed_name_field_service_dependency() -> None:
    # Arrange
    signature = inspect.signature(ExtraAppService.__init__)

    # Act
    parameter = signature.parameters["name_field_extraction_service"]

    # Assert
    assert parameter.annotation == NameFieldExtractionService | None


def test_extra_routes_name_field_paths_match_planned_contract() -> None:
    # Assert
    assert ExtraRoutes.NAME_FIELD_SNAPSHOT_PATH == "/api/extra/name-fields/snapshot"
    assert ExtraRoutes.NAME_FIELD_EXTRACT_PATH == "/api/extra/name-fields/extract"
    assert ExtraRoutes.NAME_FIELD_TRANSLATE_PATH == "/api/extra/name-fields/translate"
    assert (
        ExtraRoutes.NAME_FIELD_SAVE_GLOSSARY_PATH
        == "/api/extra/name-fields/save-to-glossary"
    )
