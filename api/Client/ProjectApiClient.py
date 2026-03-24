from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.ProjectRoutes import ProjectRoutes


class ProjectApiClient:
    """工程 API 客户端，屏蔽具体路由细节。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def load_project(self, request: dict[str, Any]) -> dict[str, Any]:
        """加载工程并返回项目快照。"""

        return self.api_client.post(ProjectRoutes.LOAD_PATH, request)

    def create_project(self, request: dict[str, Any]) -> dict[str, Any]:
        """创建工程并返回项目快照。"""

        return self.api_client.post(ProjectRoutes.CREATE_PATH, request)

    def get_project_snapshot(self) -> dict[str, Any]:
        """查询工程快照，供 UI 首屏 hydration 使用。"""

        return self.api_client.post(ProjectRoutes.SNAPSHOT_PATH, {})
