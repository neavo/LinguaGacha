from typing import Any

from api.Client.ApiClient import ApiClient
from api.Models.Workbench import WorkbenchSnapshot
from api.Server.Routes.V2.ProjectRoutes import V2ProjectRoutes


class WorkbenchApiClient:
    """工作台 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_snapshot(self) -> WorkbenchSnapshot:
        """读取工作台快照，供页面首屏和主动刷新共用。"""

        response = self.api_client.post(V2ProjectRoutes.WORKBENCH_SNAPSHOT_PATH, {})
        return WorkbenchSnapshot.from_dict(response.get("snapshot", {}))

    def add_file(self, path: str) -> dict[str, Any]:
        """调度新增文件操作。"""

        return self.api_client.post(V2ProjectRoutes.WORKBENCH_ADD_FILE_PATH, {"path": path})

    def replace_file(self, rel_path: str, path: str) -> dict[str, Any]:
        """调度替换文件操作。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_REPLACE_FILE_PATH,
            {"rel_path": rel_path, "path": path},
        )

    def replace_file_batch(self, operations: list[dict[str, str]]) -> dict[str, Any]:
        """调度批量替换文件操作。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_REPLACE_FILE_BATCH_PATH,
            {"operations": operations},
        )

    def reset_file(self, rel_path: str) -> dict[str, Any]:
        """调度重置文件操作。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_RESET_FILE_PATH, {"rel_path": rel_path}
        )

    def reset_file_batch(self, rel_paths: list[str]) -> dict[str, Any]:
        """调度批量重置文件操作。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_RESET_FILE_BATCH_PATH,
            {"rel_paths": rel_paths},
        )

    def delete_file(self, rel_path: str) -> dict[str, Any]:
        """调度删除文件操作。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_DELETE_FILE_PATH,
            {"rel_path": rel_path},
        )

    def delete_file_batch(self, rel_paths: list[str]) -> dict[str, Any]:
        """调度批量删除文件操作。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_DELETE_FILE_BATCH_PATH,
            {"rel_paths": rel_paths},
        )

    def reorder_files(self, ordered_rel_paths: list[str]) -> dict[str, Any]:
        """持久化工作台文件顺序，供拖拽排序后立即写回工程。"""

        return self.api_client.post(
            V2ProjectRoutes.WORKBENCH_REORDER_FILES_PATH,
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
            V2ProjectRoutes.WORKBENCH_FILE_PATCH_PATH,
            {
                "rel_paths": rel_paths,
                "removed_rel_paths": removed_rel_paths,
                "include_order": include_order,
            },
        )

    def get_supported_extensions(self) -> list[str]:
        """读取工作台导入文件选择器支持的扩展名。"""

        response = self.api_client.post(V2ProjectRoutes.WORKBENCH_EXTENSIONS_PATH, {})
        extensions = response.get("extensions", [])
        return [str(extension) for extension in extensions]
