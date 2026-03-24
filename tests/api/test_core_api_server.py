import httpx

from api.Application.SettingsAppService import SettingsAppService
from api.Server.ServerBootstrap import ServerBootstrap


def test_health_endpoint_returns_ok() -> None:
    base_url, shutdown = ServerBootstrap.start_for_test()
    try:
        response = httpx.get(f"{base_url}/api/health")
        assert response.status_code == 200
        assert response.json()["ok"] is True
    finally:
        shutdown()


def test_settings_snapshot_endpoint_returns_ok(fake_settings_config) -> None:
    base_url, shutdown = ServerBootstrap.start_for_test(
        settings_app_service=SettingsAppService(
            config_loader=lambda: fake_settings_config
        )
    )
    try:
        response = httpx.post(f"{base_url}/api/settings/app")

        assert response.status_code == 200
        assert response.json()["data"]["settings"]["app_language"] == "ZH"
    finally:
        shutdown()
