from typing import Any

from api.Client.ApiClient import ApiClient
from api.Models.Task import AnalysisGlossaryImportResult
from api.Models.Task import TaskSnapshot
from api.Server.Routes.V2.TaskRoutes import V2TaskRoutes


class TaskApiClient:
    """任务 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def post_task_snapshot(
        self,
        path: str,
        request: dict[str, Any] | None = None,
    ) -> TaskSnapshot:
        """统一发送任务命令并解码快照，避免各入口重复解析 `task` 字段。"""

        response = self.api_client.post(path, request or {})
        return TaskSnapshot.from_dict(response.get("task", {}))

    def start_translation(self, request: dict[str, Any]) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.START_TRANSLATION_PATH, request)

    def stop_translation(self) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.STOP_TRANSLATION_PATH)

    def reset_translation_all(self) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.RESET_TRANSLATION_ALL_PATH)

    def reset_translation_failed(self) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.RESET_TRANSLATION_FAILED_PATH)

    def start_analysis(self, request: dict[str, Any]) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.START_ANALYSIS_PATH, request)

    def stop_analysis(self) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.STOP_ANALYSIS_PATH)

    def reset_analysis_all(self) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.RESET_ANALYSIS_ALL_PATH)

    def reset_analysis_failed(self) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.RESET_ANALYSIS_FAILED_PATH)

    def import_analysis_glossary(self) -> AnalysisGlossaryImportResult:
        response = self.api_client.post(V2TaskRoutes.IMPORT_ANALYSIS_GLOSSARY_PATH, {})
        return AnalysisGlossaryImportResult.from_dict(response)

    def export_translation(self) -> dict[str, Any]:
        return self.api_client.post(V2TaskRoutes.EXPORT_TRANSLATION_PATH, {})

    def get_task_snapshot(
        self,
        request: dict[str, Any] | None = None,
    ) -> TaskSnapshot:
        return self.post_task_snapshot(V2TaskRoutes.SNAPSHOT_PATH, request)
