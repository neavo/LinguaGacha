from typing import Any

from api.Contract.WorkbenchPayloads import WorkbenchFileEntryPayload
from api.Contract.WorkbenchPayloads import WorkbenchSnapshotPayload
from module.Data.DataManager import DataManager


class WorkbenchAppService:
    """工作台用例层，负责把文件操作与快照查询收口为稳定响应载荷。"""

    def __init__(self, data_manager: Any | None = None) -> None:
        self.data_manager = (
            data_manager if data_manager is not None else DataManager.get()
        )

    def get_snapshot(self, request: dict[str, Any]) -> dict[str, object]:
        """显式查询工作台快照，供页面首屏与主动刷新使用。"""

        del request
        return {"snapshot": self.build_snapshot()}

    def add_file(self, request: dict[str, Any]) -> dict[str, object]:
        """调度新增文件操作。"""

        path = str(request.get("path", ""))
        self.data_manager.schedule_add_file(path)
        return {"accepted": True}

    def replace_file(self, request: dict[str, Any]) -> dict[str, object]:
        """调度替换文件操作。"""

        rel_path = str(request.get("rel_path", ""))
        path = str(request.get("path", ""))
        self.data_manager.schedule_replace_file(rel_path, path)
        return {"accepted": True}

    def reset_file(self, request: dict[str, Any]) -> dict[str, object]:
        """调度重置文件操作。"""

        rel_path = str(request.get("rel_path", ""))
        self.data_manager.schedule_reset_file(rel_path)
        return {"accepted": True}

    def delete_file(self, request: dict[str, Any]) -> dict[str, object]:
        """调度删除文件操作。"""

        rel_path = str(request.get("rel_path", ""))
        self.data_manager.schedule_delete_file(rel_path)
        return {"accepted": True}

    def reorder_files(self, request: dict[str, Any]) -> dict[str, object]:
        """按前端拖拽后的完整顺序持久化工作台文件列表。"""

        ordered_rel_paths_raw = request.get("ordered_rel_paths", [])
        ordered_rel_paths = (
            [str(rel_path) for rel_path in ordered_rel_paths_raw]
            if isinstance(ordered_rel_paths_raw, list)
            else []
        )
        self.data_manager.schedule_reorder_files(ordered_rel_paths)
        return {"accepted": True}

    def get_supported_extensions(self, request: dict[str, Any]) -> dict[str, object]:
        """提供工作台导入文件选择器需要的支持格式列表。"""

        del request
        extensions = self.data_manager.get_supported_extensions()
        return {"extensions": sorted(str(extension) for extension in extensions)}

    def build_snapshot(self) -> dict[str, object]:
        """把内部冻结快照转换为纯 JSON 响应载荷。"""

        snapshot = self.data_manager.build_workbench_snapshot()
        entries = tuple(
            WorkbenchFileEntryPayload(
                rel_path=str(entry.rel_path),
                item_count=int(entry.item_count),
                file_type=str(entry.file_type.value),
            )
            for entry in snapshot.entries
        )
        return WorkbenchSnapshotPayload(
            file_count=int(snapshot.file_count),
            total_items=int(snapshot.total_items),
            translated=int(snapshot.translated),
            translated_in_past=int(snapshot.translated_in_past),
            error_count=int(snapshot.error_count),
            untranslated=int(snapshot.untranslated),
            file_op_running=bool(self.data_manager.is_file_op_running()),
            entries=entries,
        ).to_dict()
