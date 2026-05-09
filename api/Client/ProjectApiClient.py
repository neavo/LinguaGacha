from typing import Any

from api.Client.ApiClient import ApiClient
from api.Contract.ApiPaths import ProjectApiPaths
from api.Models.Project import ProjectPreview
from api.Models.Project import ProjectSnapshot


class ProjectApiClient:
    """工程 API 客户端，屏蔽具体路由细节。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def load_project(self, request: dict[str, Any]) -> ProjectSnapshot:
        """加载工程并返回项目快照。"""

        response = self.api_client.post(ProjectApiPaths.LOAD_PATH, request)
        return ProjectSnapshot.from_dict(response.get("project", {}))

    def get_project_snapshot(self) -> ProjectSnapshot:
        """查询工程快照，供 UI 首屏 hydration 使用。"""

        response = self.api_client.post(ProjectApiPaths.SNAPSHOT_PATH, {})
        return ProjectSnapshot.from_dict(response.get("project", {}))

    def unload_project(self) -> ProjectSnapshot:
        """关闭当前工程并返回最新快照。"""

        response = self.api_client.post(ProjectApiPaths.UNLOAD_PATH, {})
        return ProjectSnapshot.from_dict(response.get("project", {}))

    def collect_source_files(self, source_paths: list[str]) -> list[str]:
        """探测给定路径下可导入的源文件列表。"""

        response = self.api_client.post(
            ProjectApiPaths.SOURCE_FILES_PATH,
            {"source_paths": source_paths},
        )
        source_files = response.get("source_files", [])
        return [str(file_path) for file_path in source_files]

    def get_project_preview(self, path: str) -> ProjectPreview:
        """读取指定工程的预览摘要。"""

        response = self.api_client.post(ProjectApiPaths.PREVIEW_PATH, {"path": path})
        return ProjectPreview.from_dict(response.get("preview", {}))
