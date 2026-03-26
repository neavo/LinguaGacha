import inspect

import pytest

from api.Application.ExtraAppService import ExtraAppService
from api.Server.Routes.ExtraRoutes import ExtraRoutes
from module.Data.Extra.LaboratoryService import LaboratoryService
from module.Data.Extra.TsConversionService import TsConversionService
from tests.api.support.application_fakes import FakeSettingsConfig


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
