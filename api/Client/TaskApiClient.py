from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.TaskRoutes import TaskRoutes
from model.Api.TaskModels import TaskSnapshot


class TaskApiClient:
    """任务 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def start_translation(self, request: dict[str, Any]) -> TaskSnapshot:
        response = self.api_client.post(TaskRoutes.START_TRANSLATION_PATH, request)
        return TaskSnapshot.from_dict(response.get("task", {}))

    def stop_translation(self) -> TaskSnapshot:
        response = self.api_client.post(TaskRoutes.STOP_TRANSLATION_PATH, {})
        return TaskSnapshot.from_dict(response.get("task", {}))

    def start_analysis(self, request: dict[str, Any]) -> TaskSnapshot:
        response = self.api_client.post(TaskRoutes.START_ANALYSIS_PATH, request)
        return TaskSnapshot.from_dict(response.get("task", {}))

    def stop_analysis(self) -> TaskSnapshot:
        response = self.api_client.post(TaskRoutes.STOP_ANALYSIS_PATH, {})
        return TaskSnapshot.from_dict(response.get("task", {}))

    def get_task_snapshot(
        self,
        request: dict[str, Any] | None = None,
    ) -> TaskSnapshot:
        response = self.api_client.post(TaskRoutes.SNAPSHOT_PATH, request or {})
        return TaskSnapshot.from_dict(response.get("task", {}))
