import inspect

import pytest

from api.Application.ExtraAppService import ExtraAppService
from api.Server.Routes.ExtraRoutes import ExtraRoutes
from tests.api.support.application_fakes import FakeSettingsConfig


@pytest.fixture
def fake_config() -> FakeSettingsConfig:
    config = FakeSettingsConfig()
    config.mtool_optimizer_enable = False
    config.force_thinking_enable = True
    return config


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
