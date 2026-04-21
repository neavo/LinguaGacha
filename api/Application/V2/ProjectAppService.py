from __future__ import annotations

from typing import Any

from api.Application.ProjectAppService import ProjectAppService


class V2ProjectAppService:
    """V2 项目路由的薄包装层，复用现有项目用例实现。"""

    def __init__(self, project_app_service: ProjectAppService | None = None) -> None:
        self.project_app_service = (
            project_app_service if project_app_service is not None else ProjectAppService()
        )

    def load_project(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.load_project(request)

    def create_project(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.create_project(request)

    def get_project_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.get_project_snapshot(request)

    def unload_project(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.unload_project(request)

    def get_supported_extensions(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.get_supported_extensions(request)

    def collect_source_files(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.collect_source_files(request)

    def get_project_preview(self, request: dict[str, Any]) -> dict[str, object]:
        return self.project_app_service.get_project_preview(request)
