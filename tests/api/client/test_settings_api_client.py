from collections.abc import Callable

from api.Application.SettingsAppService import SettingsAppService
from api.Client.ApiClient import ApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from model.Api.SettingsModels import AppSettingsSnapshot
from model.Api.SettingsModels import RecentProjectEntry
from tests.api.support.application_fakes import FakeSettingsConfig


def test_settings_api_client_get_app_settings_returns_snapshot(
    fake_settings_config: FakeSettingsConfig,
    start_api_server: Callable[..., str],
) -> None:
    base_url = start_api_server(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    settings_client = SettingsApiClient(ApiClient(base_url))

    result = settings_client.get_app_settings()

    assert isinstance(result, AppSettingsSnapshot)
    assert result.request_timeout == 120
    assert result.target_language == "ZH"
    assert result.force_thinking_enable is True
    assert result.mtool_optimizer_enable is True


def test_settings_api_client_add_recent_project_returns_snapshot(
    fake_settings_config: FakeSettingsConfig,
    start_api_server: Callable[..., str],
) -> None:
    base_url = start_api_server(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    settings_client = SettingsApiClient(ApiClient(base_url))

    result = settings_client.add_recent_project("demo.lg", "demo")

    assert isinstance(result, AppSettingsSnapshot)
    assert result.recent_projects == (RecentProjectEntry(path="demo.lg", name="demo"),)
