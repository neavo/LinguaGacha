import pytest

from tests.api.support.application_fakes import FakeSettingsConfig


@pytest.fixture
def fake_config() -> FakeSettingsConfig:
    config = FakeSettingsConfig()
    config.mtool_optimizer_enable = False
    config.force_thinking_enable = True
    return config


def test_laboratory_service_returns_snapshot(fake_config: FakeSettingsConfig) -> None:
    from module.Data.Extra.LaboratoryService import LaboratoryService

    # Arrange
    service = LaboratoryService(config_loader=lambda: fake_config)

    # Act
    snapshot = service.get_snapshot()

    # Assert
    assert snapshot["mtool_optimizer_enabled"] is False
    assert snapshot["force_thinking_enabled"] is True
