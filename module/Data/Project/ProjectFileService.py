from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

from module.Data.Core.Item import Item
from module.Config import Config
from module.Data.Core.ProjectSession import ProjectSession
from module.Localizer.Localizer import Localizer


class ProjectFileService:
    """工程文件服务。"""

    def __init__(
        self,
        session: ProjectSession,
        supported_extensions: set[str],
    ) -> None:
        self.session = session
        self.supported_extensions = set(supported_extensions)
        self.file_op_lock = threading.Lock()
        self.file_op_running = False

    def is_file_op_running(self) -> bool:
        with self.file_op_lock:
            return self.file_op_running

    def try_begin_file_operation(self) -> bool:
        with self.file_op_lock:
            if self.file_op_running:
                return False
            self.file_op_running = True
            return True

    def finish_file_operation(self) -> None:
        with self.file_op_lock:
            self.file_op_running = False

    def resolve_enum_value(self, value: object) -> str:
        raw_value = getattr(value, "value", value)
        return str(raw_value or "NONE")

    def resolve_status_value(self, value: object) -> str:
        raw_value = getattr(value, "value", value)
        return str(raw_value or "NONE")

    def normalize_preview_item_payload(
        self,
        item_dict: dict[str, Any],
    ) -> dict[str, Any]:
        """把解析结果转换成稳定 JSON 结构，供 TS planner 复用。"""

        return {
            "src": str(item_dict.get("src", "") or ""),
            "dst": str(item_dict.get("dst", "") or ""),
            "name_src": item_dict.get("name_src"),
            "name_dst": item_dict.get("name_dst"),
            "extra_field": item_dict.get("extra_field", ""),
            "tag": str(item_dict.get("tag", "") or ""),
            "row": int(item_dict.get("row", 0) or 0),
            "file_type": self.resolve_enum_value(item_dict.get("file_type")),
            "file_path": str(item_dict.get("file_path", "") or ""),
            "text_type": self.resolve_enum_value(item_dict.get("text_type")),
            "status": self.resolve_status_value(item_dict.get("status", "NONE")),
            "retry_count": int(item_dict.get("retry_count", 0) or 0),
        }

    def parse_file_preview(
        self,
        file_path: str,
        *,
        current_rel_path: str | None = None,
    ) -> dict[str, object]:
        """只读解析本地文件，返回前端 planner 需要的标准化结果。"""

        ext = Path(file_path).suffix.lower()
        if ext not in self.supported_extensions:
            raise ValueError(Localizer.get().workbench_msg_unsupported_format)

        if current_rel_path:
            target_rel_path = self.build_replace_target_rel_path(
                current_rel_path,
                file_path,
            )
        else:
            target_rel_path = os.path.basename(file_path)
        if target_rel_path == "":
            raise ValueError(Localizer.get().workbench_msg_file_not_found)

        with open(file_path, "rb") as f:
            original_data = f.read()

        from module.File.FileManager import FileManager

        file_manager = FileManager(Config().load())
        parsed_items = file_manager.parse_asset(target_rel_path, original_data)
        item_dicts = [item.to_dict() for item in parsed_items]
        return {
            "target_rel_path": target_rel_path,
            "file_type": self.pick_file_type(item_dicts),
            "parsed_items": [
                self.normalize_preview_item_payload(item_dict)
                for item_dict in item_dicts
            ],
        }

    def reorder_files(self, ordered_rel_paths: list[str]) -> None:
        """按工作台给定顺序重排工程内文件。"""

        db = self.get_loaded_db()
        existing_paths = db.get_all_asset_paths()

        if len(ordered_rel_paths) != len(existing_paths):
            raise ValueError("工作台文件顺序无效")

        ordered_path_set = set(ordered_rel_paths)
        existing_path_set = set(existing_paths)
        if ordered_path_set != existing_path_set:
            raise ValueError("工作台文件顺序无效")

        with db.connection() as conn:
            db.update_asset_sort_orders(ordered_rel_paths, conn=conn)
            conn.commit()

    def get_loaded_db(self) -> Any:
        """读取已加载数据库，未加载时统一抛错。"""

        with self.session.state_lock:
            db = self.session.db
        if db is None:
            raise RuntimeError("工程未加载")
        return db

    def build_replace_target_rel_path(
        self, old_rel_path: str, new_file_path: str
    ) -> str:
        """更新文件时只替换文件名，保留原目录层级。"""

        new_name = os.path.basename(new_file_path)
        if new_name == "":
            return old_rel_path

        parent = Path(old_rel_path).parent
        if str(parent) in {".", ""}:
            return new_name
        return str(parent / new_name)

    def normalize_batch_rel_paths(self, rel_paths: list[str]) -> list[str]:
        """规范化批量文件路径，保持输入顺序且去重。"""

        normalized_rel_paths: list[str] = []
        seen: set[str] = set()
        for rel_path in rel_paths:
            normalized_rel_path = str(rel_path).strip()
            if normalized_rel_path == "":
                continue
            normalized_key = normalized_rel_path.casefold()
            if normalized_key in seen:
                continue
            seen.add(normalized_key)
            normalized_rel_paths.append(normalized_rel_path)

        if not normalized_rel_paths:
            raise ValueError("工作台文件路径无效")

        return normalized_rel_paths

    def pick_file_type(self, items: list[dict[str, Any]]) -> str:
        """从条目列表里挑出有效文件类型。"""

        for item in items:
            raw_type = item.get("file_type")
            if isinstance(raw_type, Item.FileType) and raw_type != Item.FileType.NONE:
                return raw_type.value
            if (
                isinstance(raw_type, str)
                and raw_type != ""
                and raw_type != Item.FileType.NONE
            ):
                return raw_type
        return str(Item.FileType.NONE)

    def ensure_replace_target_path_not_conflict(
        self,
        existing_paths: list[str],
        old_rel_path: str,
        target_rel_path: str,
    ) -> None:
        """更新重命名时检查大小写无关的重名冲突。"""

        for existing in existing_paths:
            if not isinstance(existing, str) or existing == "":
                continue
            if existing.casefold() == old_rel_path.casefold():
                continue
            if existing.casefold() == target_rel_path.casefold():
                raise ValueError(Localizer.get().workbench_msg_replace_name_conflict)
