from typing import Any

from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from api.Contract.ProjectPayloads import ProjectSnapshotPayload


class ProjectAppService:
    """工程用例层，负责把数据层调用收口为稳定响应载荷。"""

    def __init__(
        self,
        project_manager: Any | None = None,
    ) -> None:
        """初始化 ProjectAppService 依赖和状态，保持对象写入口明确。"""

        self.project_manager = (
            project_manager if project_manager is not None else DataManager.get()
        )

    def load_project(self, request: dict[str, str]) -> dict[str, object]:
        """加载既有工程，并返回序列化后的工程快照。"""

        path = str(request.get("path", ""))
        self.project_manager.load_project(path)
        return {"project": self.build_project_snapshot(path)}

    def create_project_preview(self, request: dict[str, Any]) -> dict[str, object]:
        """构建新建工程草稿，不落盘、不预过滤。"""

        source_paths = self.normalize_string_list_payload(request.get("source_paths"))
        return {
            "draft": self.project_manager.build_create_project_preview(source_paths)
        }

    def create_project_commit(self, request: dict[str, Any]) -> dict[str, object]:
        """持久化前端预过滤后的新建工程草稿并加载工程。"""

        source_paths = self.normalize_string_list_payload(request.get("source_paths"))
        output_path = str(request.get("path", "") or "")
        draft = self.normalize_dict_payload(request.get("draft"))
        files = self.normalize_list_of_dicts(draft.get("files", []))
        items = self.normalize_list_of_dicts(draft.get("items", []))
        project_settings = self.normalize_dict_payload(request.get("project_settings"))
        translation_extras = self.normalize_dict_payload(
            request.get("translation_extras")
        )
        prefilter_config = self.normalize_dict_payload(request.get("prefilter_config"))
        self.project_manager.commit_create_project_preview(
            source_paths=source_paths,
            output_path=output_path,
            files=files,
            items=items,
            project_settings=project_settings,
            translation_extras=translation_extras,
            prefilter_config=prefilter_config,
        )
        self.project_manager.load_project(output_path)
        return {"project": self.build_project_snapshot(output_path)}

    def get_open_project_alignment_preview(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        """读取打开工程前的设置对齐预览，不进入 loaded 状态。"""

        path = str(request.get("path", "") or "")
        return {
            "preview": self.project_manager.build_open_project_alignment_preview(path)
        }

    def export_converted_translation(
        self,
        request: dict[str, Any],
    ) -> dict[str, object]:
        """Python Core 不再承载文件写回，公开转换导出由 TS Gateway 处理。"""

        del request
        raise ValueError(Localizer.get().export_translation_failed)

    def build_project_snapshot(self, fallback_path: str = "") -> dict[str, object]:
        """所有工程类响应都通过这里生成，保持字段来源单一。"""

        project_path = ""
        get_lg_path = getattr(self.project_manager, "get_lg_path", None)
        if callable(get_lg_path):
            project_path = str(get_lg_path() or "")
        if project_path == "":
            project_path = fallback_path

        is_loaded = bool(self.project_manager.is_loaded())
        return ProjectSnapshotPayload(path=project_path, loaded=is_loaded).to_dict()

    def normalize_dict_payload(self, value: Any) -> dict[str, Any]:
        """把未知载荷收窄为字典，防止调用方直接信任请求体。"""

        return dict(value) if isinstance(value, dict) else {}

    def normalize_list_of_dicts(self, value: Any) -> list[dict[str, Any]]:
        """把未知载荷收窄为字典列表，保护批量 mutation 输入。"""

        if not isinstance(value, list):
            return []
        return [dict(item) for item in value if isinstance(item, dict)]

    def normalize_string_list_payload(self, value: Any) -> list[str]:
        """把未知载荷收窄为字符串列表，统一路径和 id 列表语义。"""

        if not isinstance(value, list):
            return []
        return [str(item) for item in value if isinstance(item, str)]
