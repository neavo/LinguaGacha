from typing import Any

from module.Data.DataManager import DataManager
from api.Contract.ProjectDtos import ProjectDto


class ProjectAppService:
    """工程用例层，负责把数据层调用收口为稳定 DTO。"""

    def __init__(self, project_manager: Any | None = None) -> None:
        self.project_manager = (
            project_manager if project_manager is not None else DataManager.get()
        )

    def load_project(self, request: dict[str, str]) -> dict[str, object]:
        """加载既有工程，并返回序列化后的工程快照。"""

        path = str(request.get("path", ""))
        self.project_manager.load_project(path)
        return {"project": self.build_project_snapshot(path)}

    def create_project(self, request: dict[str, str]) -> dict[str, object]:
        """创建工程后立即加载，保证 UI 首次拿到的是统一快照。"""

        source_path = str(request.get("source_path", ""))
        output_path = str(request.get("path", ""))
        self.project_manager.create_project(source_path, output_path)
        self.project_manager.load_project(output_path)
        return {"project": self.build_project_snapshot(output_path)}

    def get_project_snapshot(self, request: dict[str, str]) -> dict[str, object]:
        """提供显式查询接口，供 UI 首屏 hydration 使用。"""

        del request
        return {"project": self.build_project_snapshot()}

    def build_project_snapshot(self, fallback_path: str = "") -> dict[str, object]:
        """所有工程类响应都通过这里生成，保持字段来源单一。"""

        project_path = ""
        get_lg_path = getattr(self.project_manager, "get_lg_path", None)
        if callable(get_lg_path):
            project_path = str(get_lg_path() or "")
        if project_path == "":
            project_path = fallback_path

        is_loaded = bool(self.project_manager.is_loaded())
        return ProjectDto(path=project_path, loaded=is_loaded).to_dict()
