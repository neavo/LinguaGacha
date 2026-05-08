from typing import Any

from base.LogManager import LogManager
from module.Data.DataManager import DataManager


class WorkbenchAppService:
    """工作台用例层，负责把文件操作与局部补丁收口为稳定响应载荷。"""

    def __init__(self, data_manager: Any | None = None) -> None:
        self.data_manager = (
            data_manager if data_manager is not None else DataManager.get()
        )

    def parse_string_list(self, value: Any) -> list[str]:
        """归一工作台只读解析源路径列表，忽略非字符串值。"""

        if not isinstance(value, list):
            return []
        return [str(item) for item in value if isinstance(item, str)]

    def parse_file(self, request: dict[str, Any]) -> dict[str, object]:
        """只读解析工作台文件，批量返回 TS planner 需要的标准化结果。"""

        source_paths = self.parse_string_list(request.get("source_paths"))
        parse_preview = getattr(self.data_manager, "parse_file_preview", None)
        project_file_service = getattr(self.data_manager, "project_file_service", None)
        if not callable(parse_preview) and project_file_service is None:
            raise AttributeError("缺少 project_file_service.parse_file_preview")

        files: list[dict[str, object]] = []
        for source_path in source_paths:
            try:
                preview = (
                    parse_preview(source_path)
                    if callable(parse_preview)
                    else project_file_service.parse_file_preview(source_path)
                )
            except Exception as e:
                # 批量预解析允许单个文件失败，调用方只关心整批中可添加的文件。
                LogManager.get().warning(f"工作台文件预解析失败 - {source_path}", e)
                continue
            files.append(
                {
                    "source_path": source_path,
                    **dict(preview),
                }
            )
        return {"files": files}
