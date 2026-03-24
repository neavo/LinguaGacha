from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.TaskRoutes import TaskRoutes


class TaskApiClient:
    """任务 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def start_translation(self, request: dict[str, Any]) -> dict[str, Any]:
        return self.api_client.post(TaskRoutes.START_TRANSLATION_PATH, request)

    def stop_translation(self) -> dict[str, Any]:
        return self.api_client.post(TaskRoutes.STOP_TRANSLATION_PATH, {})

    def start_analysis(self, request: dict[str, Any]) -> dict[str, Any]:
        return self.api_client.post(TaskRoutes.START_ANALYSIS_PATH, request)

    def stop_analysis(self) -> dict[str, Any]:
        return self.api_client.post(TaskRoutes.STOP_ANALYSIS_PATH, {})

    def get_task_snapshot(self) -> dict[str, Any]:
        return self.api_client.post(TaskRoutes.SNAPSHOT_PATH, {})
