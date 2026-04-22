from typing import Any

from api.v2.Client.ApiClient import ApiClient
from api.v2.Server.Routes.ProjectRoutes import ProjectRoutes


class WorkbenchApiClient:
    """工作台 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def add_file(self, path: str) -> dict[str, Any]:
        """执行新增文件操作。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_ADD_FILE_PATH, {"path": path}
        )

    def replace_file(self, rel_path: str, path: str) -> dict[str, Any]:
        """执行替换文件操作。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_REPLACE_FILE_PATH,
            {"rel_path": rel_path, "path": path},
        )

    def reset_file(self, rel_path: str) -> dict[str, Any]:
        """执行重置文件操作。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_RESET_FILE_PATH, {"rel_path": rel_path}
        )

    def delete_file(self, rel_path: str) -> dict[str, Any]:
        """执行删除文件操作。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_DELETE_FILE_PATH,
            {"rel_path": rel_path},
        )

    def delete_file_batch(self, rel_paths: list[str]) -> dict[str, Any]:
        """执行批量删除文件操作。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_DELETE_FILE_BATCH_PATH,
            {"rel_paths": rel_paths},
        )

    def reorder_files(self, ordered_rel_paths: list[str]) -> dict[str, Any]:
        """持久化工作台文件顺序，供拖拽排序后立即写回工程。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_REORDER_FILES_PATH,
            {"ordered_rel_paths": ordered_rel_paths},
        )

    def get_file_patch(
        self,
        *,
        rel_paths: list[str],
        removed_rel_paths: list[str],
        include_order: bool,
    ) -> dict[str, Any]:
        """按文件路径读取工作台局部补丁。"""

        return self.api_client.post(
            ProjectRoutes.WORKBENCH_FILE_PATCH_PATH,
            {
                "rel_paths": rel_paths,
                "removed_rel_paths": removed_rel_paths,
                "include_order": include_order,
            },
        )
