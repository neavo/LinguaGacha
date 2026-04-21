from typing import Any

from api.v2.Contract.WorkbenchPayloads import WorkbenchFileEntryPayload
from api.v2.Contract.WorkbenchPayloads import WorkbenchFilePatchPayload
from api.v2.Contract.WorkbenchPayloads import WorkbenchSummaryPayload
from api.v2.Contract.WorkbenchPayloads import WorkbenchSnapshotPayload
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

    def delete_file_batch(self, request: dict[str, Any]) -> dict[str, object]:
        """调度批量删除文件操作。"""

        rel_paths_raw = request.get("rel_paths", [])
        rel_paths = (
            [str(rel_path) for rel_path in rel_paths_raw]
            if isinstance(rel_paths_raw, list)
            else []
        )
        self.data_manager.schedule_delete_file_batch(rel_paths)
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

    def get_file_patch(self, request: dict[str, Any]) -> dict[str, object]:
        """按文件影响范围返回工作台局部补丁。"""

        rel_paths_raw = request.get("rel_paths", [])
        rel_paths = (
            [str(rel_path) for rel_path in rel_paths_raw]
            if isinstance(rel_paths_raw, list)
            else []
        )
        removed_rel_paths_raw = request.get("removed_rel_paths", [])
        removed_rel_paths = (
            [str(rel_path) for rel_path in removed_rel_paths_raw]
            if isinstance(removed_rel_paths_raw, list)
            else []
        )
        include_order = bool(request.get("include_order", False))

        snapshot = self.data_manager.build_workbench_snapshot()
        patched_entries = self.data_manager.build_workbench_entry_patch(rel_paths)
        return {
            "patch": WorkbenchFilePatchPayload(
                summary=self.build_summary(snapshot),
                ordered_rel_paths=(
                    tuple(entry.rel_path for entry in snapshot.entries)
                    if include_order
                    else ()
                ),
                removed_rel_paths=tuple(
                    rel_path for rel_path in removed_rel_paths if rel_path != ""
                ),
                entries=tuple(
                    WorkbenchFileEntryPayload(
                        rel_path=str(entry.rel_path),
                        item_count=int(entry.item_count),
                        file_type=str(entry.file_type.value),
                    )
                    for entry in patched_entries
                ),
            ).to_dict()
        }

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
            summary=self.build_summary(snapshot),
            entries=entries,
        ).to_dict()

    def build_summary(self, snapshot: Any) -> WorkbenchSummaryPayload:
        """把内部工作台快照摘要收口为稳定 JSON 载荷。"""

        return WorkbenchSummaryPayload(
            file_count=int(snapshot.file_count),
            total_items=int(snapshot.total_items),
            translated=int(snapshot.translated),
            translated_in_past=int(snapshot.translated_in_past),
            error_count=int(snapshot.error_count),
            untranslated=int(snapshot.untranslated),
            file_op_running=bool(self.data_manager.is_file_op_running()),
        )
