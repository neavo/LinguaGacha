from typing import Any

from api.Client.ApiClient import ApiClient
from api.Models.ProjectRuntime import ProjectMutationAck
from api.Server.Routes.ProjectRoutes import ProjectRoutes


class WorkbenchApiClient:
    """工作台 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def parse_file(
        self,
        source_paths: list[str],
    ) -> dict[str, Any]:
        request: dict[str, Any] = {"source_paths": source_paths}
        return self.api_client.post(
            ProjectRoutes.WORKBENCH_PARSE_FILE_PATH,
            request,
        )

    def add_file(
        self,
        files: list[dict[str, Any]],
        derived_meta: dict[str, Any],
        expected_section_revisions: dict[str, int],
    ) -> ProjectMutationAck:
        """执行新增文件操作，文件数量由 files 数组表达。"""

        response = self.api_client.post(
            ProjectRoutes.WORKBENCH_ADD_FILE_PATH,
            {
                "files": files,
                "derived_meta": derived_meta,
                "expected_section_revisions": expected_section_revisions,
            },
        )
        return ProjectMutationAck.from_dict(response)

    def reset_file(
        self,
        rel_paths: list[str],
        items: list[dict[str, Any]],
        derived_meta: dict[str, Any],
        expected_section_revisions: dict[str, int],
    ) -> ProjectMutationAck:
        """执行重置文件操作，文件数量由 rel_paths 数组表达。"""

        response = self.api_client.post(
            ProjectRoutes.WORKBENCH_RESET_FILE_PATH,
            {
                "rel_paths": rel_paths,
                "items": items,
                "derived_meta": derived_meta,
                "expected_section_revisions": expected_section_revisions,
            },
        )
        return ProjectMutationAck.from_dict(response)

    def delete_file(
        self,
        rel_paths: list[str],
        derived_meta: dict[str, Any],
        expected_section_revisions: dict[str, int],
    ) -> ProjectMutationAck:
        """执行删除文件操作，文件数量由 rel_paths 数组表达。"""

        response = self.api_client.post(
            ProjectRoutes.WORKBENCH_DELETE_FILE_PATH,
            {
                "rel_paths": rel_paths,
                "derived_meta": derived_meta,
                "expected_section_revisions": expected_section_revisions,
            },
        )
        return ProjectMutationAck.from_dict(response)

    def reorder_files(
        self,
        ordered_rel_paths: list[str],
        expected_section_revisions: dict[str, int],
    ) -> ProjectMutationAck:
        """持久化工作台文件顺序，供拖拽排序后立即写回工程。"""

        response = self.api_client.post(
            ProjectRoutes.WORKBENCH_REORDER_FILES_PATH,
            {
                "ordered_rel_paths": ordered_rel_paths,
                "expected_section_revisions": expected_section_revisions,
            },
        )
        return ProjectMutationAck.from_dict(response)
