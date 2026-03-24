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

    def unload_project(self) -> dict[str, Any]:
        """关闭当前工程并返回最新快照。"""

        return self.api_client.post(ProjectRoutes.UNLOAD_PATH, {})

    def get_supported_extensions(self) -> list[str]:
        """读取源文件选择器支持的扩展名。"""

        response = self.api_client.post(ProjectRoutes.EXTENSIONS_PATH, {})
        extensions = response.get("extensions", [])
        return [str(extension) for extension in extensions]

    def collect_source_files(self, path: str) -> list[str]:
        """探测给定路径下可导入的源文件列表。"""

        response = self.api_client.post(ProjectRoutes.SOURCE_FILES_PATH, {"path": path})
        source_files = response.get("source_files", [])
        return [str(file_path) for file_path in source_files]

    def get_project_preview(self, path: str) -> dict[str, Any]:
        """读取指定工程的预览摘要。"""

        response = self.api_client.post(ProjectRoutes.PREVIEW_PATH, {"path": path})
        return dict(response.get("preview", {}))
