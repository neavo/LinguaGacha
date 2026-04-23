from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.SettingsRoutes import SettingsRoutes
from api.Models.Settings import AppSettingsSnapshot


class SettingsApiClient:
    """应用设置 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_app_settings(self) -> AppSettingsSnapshot:
        """读取应用设置快照。"""

        response = self.api_client.post(SettingsRoutes.SNAPSHOT_PATH, {})
        return AppSettingsSnapshot.from_dict(response.get("settings", {}))

    def update_app_settings(self, request: dict[str, Any]) -> AppSettingsSnapshot:
        """提交局部设置更新并返回最新快照。"""

        response = self.api_client.post(SettingsRoutes.UPDATE_PATH, request)
        return AppSettingsSnapshot.from_dict(response.get("settings", {}))

    def add_recent_project(self, path: str, name: str) -> AppSettingsSnapshot:
        """新增最近项目条目，并返回最新设置快照。"""

        response = self.api_client.post(
            SettingsRoutes.ADD_RECENT_PROJECT_PATH,
            {"path": path, "name": name},
        )
        return AppSettingsSnapshot.from_dict(response.get("settings", {}))

    def remove_recent_project(self, path: str) -> AppSettingsSnapshot:
        """移除最近项目条目，并返回最新设置快照。"""

        response = self.api_client.post(
            SettingsRoutes.REMOVE_RECENT_PROJECT_PATH,
            {"path": path},
        )
        return AppSettingsSnapshot.from_dict(response.get("settings", {}))
