from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.WorkbenchRoutes import WorkbenchRoutes


class WorkbenchApiClient:
    """工作台 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_snapshot(self) -> dict[str, Any]:
        """读取工作台快照，供页面首屏和主动刷新共用。"""

        return self.api_client.post(WorkbenchRoutes.SNAPSHOT_PATH, {})

    def add_file(self, path: str) -> dict[str, Any]:
        """调度新增文件操作。"""

        return self.api_client.post(WorkbenchRoutes.ADD_FILE_PATH, {"path": path})

    def replace_file(self, rel_path: str, path: str) -> dict[str, Any]:
        """调度替换文件操作。"""

        return self.api_client.post(
            WorkbenchRoutes.REPLACE_FILE_PATH,
            {"rel_path": rel_path, "path": path},
        )

    def reset_file(self, rel_path: str) -> dict[str, Any]:
        """调度重置文件操作。"""

        return self.api_client.post(
            WorkbenchRoutes.RESET_FILE_PATH, {"rel_path": rel_path}
        )

    def delete_file(self, rel_path: str) -> dict[str, Any]:
        """调度删除文件操作。"""

        return self.api_client.post(
            WorkbenchRoutes.DELETE_FILE_PATH,
            {"rel_path": rel_path},
        )

    def get_supported_extensions(self) -> list[str]:
        """读取工作台导入文件选择器支持的扩展名。"""

        response = self.api_client.post(WorkbenchRoutes.EXTENSIONS_PATH, {})
        extensions = response.get("extensions", [])
        return [str(extension) for extension in extensions]
