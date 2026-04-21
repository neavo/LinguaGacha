from collections.abc import Callable

from api.v2.Application.SettingsAppService import SettingsAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.SettingsApiClient import SettingsApiClient
from api.v2.Models.Settings import AppSettingsSnapshot
from api.v2.Models.Settings import RecentProjectEntry
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


def test_settings_api_client_update_app_settings_returns_updated_snapshot(
    fake_settings_config: FakeSettingsConfig,
    start_api_server: Callable[..., str],
) -> None:
    base_url = start_api_server(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    settings_client = SettingsApiClient(ApiClient(base_url))

    result = settings_client.update_app_settings(
        {
            "request_timeout": 300,
            "target_language": "EN",
        }
    )

    assert isinstance(result, AppSettingsSnapshot)
    assert result.request_timeout == 300
    assert result.target_language == "EN"


def test_settings_api_client_remove_recent_project_returns_snapshot(
    fake_settings_config: FakeSettingsConfig,
    start_api_server: Callable[..., str],
) -> None:
    fake_settings_config.add_recent_project("demo.lg", "demo")
    base_url = start_api_server(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    settings_client = SettingsApiClient(ApiClient(base_url))

    result = settings_client.remove_recent_project("demo.lg")

    assert isinstance(result, AppSettingsSnapshot)
    assert result.recent_projects == ()
