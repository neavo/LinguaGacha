from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.SettingsRoutes import SettingsRoutes


class SettingsApiClient:
    """应用设置 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_app_settings(self) -> dict[str, Any]:
        """读取应用设置快照。"""

        return self.api_client.post(SettingsRoutes.SNAPSHOT_PATH, {})

    def update_app_settings(self, request: dict[str, Any]) -> dict[str, Any]:
        """提交局部设置更新并返回最新快照。"""

        return self.api_client.post(SettingsRoutes.UPDATE_PATH, request)

    def add_recent_project(self, path: str, name: str) -> dict[str, Any]:
        """新增最近项目条目，并返回最新设置快照。"""

        return self.api_client.post(
            SettingsRoutes.ADD_RECENT_PROJECT_PATH,
            {"path": path, "name": name},
        )

    def remove_recent_project(self, path: str) -> dict[str, Any]:
        """移除最近项目条目，并返回最新设置快照。"""

        return self.api_client.post(
            SettingsRoutes.REMOVE_RECENT_PROJECT_PATH,
            {"path": path},
        )
