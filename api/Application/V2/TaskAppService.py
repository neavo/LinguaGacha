from __future__ import annotations

from typing import Any

from api.Application.TaskAppService import TaskAppService


class V2TaskAppService:
    """V2 任务路由的薄包装层，复用现有任务用例实现。"""

    def __init__(self, task_app_service: TaskAppService | None = None) -> None:
        self.task_app_service = (
            task_app_service if task_app_service is not None else TaskAppService()
        )

    def start_translation(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.start_translation(request)

    def stop_translation(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.stop_translation(request)

    def reset_translation_all(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.reset_translation_all(request)

    def reset_translation_failed(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.reset_translation_failed(request)

    def start_analysis(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.start_analysis(request)

    def stop_analysis(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.stop_analysis(request)

    def reset_analysis_all(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.reset_analysis_all(request)

    def reset_analysis_failed(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.reset_analysis_failed(request)

    def import_analysis_glossary(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.import_analysis_glossary(request)

    def get_task_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.get_task_snapshot(request)

    def export_translation(self, request: dict[str, Any]) -> dict[str, object]:
        return self.task_app_service.export_translation(request)
