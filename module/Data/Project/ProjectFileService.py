from __future__ import annotations

import os
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

from base.Base import Base
from model.Item import Item
from module.Data.Analysis.AnalysisService import AnalysisService
from module.Config import Config
from module.Data.Core.DataTypes import ProjectFileMutationResult
from module.Data.Core.ItemService import ItemService
from module.Data.Core.ProjectSession import ProjectSession
from module.Localizer.Localizer import Localizer
from module.Utils.GapTool import GapTool
from module.Utils.ZstdTool import ZstdTool


class ProjectFileService:
    """工程文件服务。"""

    def __init__(
        self,
        session: ProjectSession,
        item_service: ItemService,
        analysis_service: AnalysisService,
        supported_extensions: set[str],
    ) -> None:
        self.session = session
        self.item_service = item_service
        self.analysis_service = analysis_service
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

    def add_file(self, file_path: str) -> ProjectFileMutationResult:
        """把外部文件导入工程。"""

        ext = Path(file_path).suffix.lower()
        if ext not in self.supported_extensions:
            raise ValueError(Localizer.get().workbench_msg_unsupported_format)

        rel_path = os.path.basename(file_path)
        db = self.get_loaded_db()
        if db.asset_path_exists(rel_path):
            raise ValueError(Localizer.get().workbench_msg_file_exists)

        with open(file_path, "rb") as f:
            original_data = f.read()

        from module.File.FileManager import FileManager

        file_manager = FileManager(Config().load())
        items = file_manager.parse_asset(rel_path, original_data)
        item_dicts: list[dict[str, Any]] = []
        for item in GapTool.iter(items):
            item_dicts.append(item.to_dict())

        db.add_asset(rel_path, ZstdTool.compress(original_data), len(original_data))
        db.insert_items(item_dicts)

        self.item_service.clear_item_cache()
        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(
            rel_paths=(rel_path,),
            new=len(item_dicts),
            total=len(item_dicts),
        )

    def replace_file(
        self,
        rel_path: str,
        new_file_path: str,
    ) -> ProjectFileMutationResult:
        """更新工程内文件，只继承旧工程里的完成态译文成果。"""

        db = self.get_loaded_db()
        target_rel_path = self.build_replace_target_rel_path(rel_path, new_file_path)
        if target_rel_path.casefold() == rel_path.casefold():
            target_rel_path = rel_path

        old_items = db.get_items_by_file_path(rel_path)
        with open(new_file_path, "rb") as f:
            original_data = f.read()

        from module.File.FileManager import FileManager

        file_manager = FileManager(Config().load())
        new_items = file_manager.parse_asset(target_rel_path, original_data)
        new_item_dicts: list[dict[str, Any]] = []
        for item in GapTool.iter(new_items):
            new_item_dicts.append(item.to_dict())

        old_type = self.pick_file_type(old_items)
        new_type = self.pick_file_type(new_item_dicts)
        if old_type != new_type:
            raise ValueError(Localizer.get().workbench_msg_replace_format_mismatch)
        if not db.asset_path_exists(rel_path):
            raise ValueError(Localizer.get().workbench_msg_file_not_found)
        if target_rel_path.casefold() != rel_path.casefold():
            self.ensure_replace_target_path_not_conflict(
                db.get_all_asset_paths(),
                rel_path,
                target_rel_path,
            )

        matched = self.inherit_completed_translations(old_items, new_item_dicts)
        with db.connection() as conn:
            db.update_asset(
                rel_path,
                ZstdTool.compress(original_data),
                len(original_data),
                conn=conn,
            )
            if target_rel_path != rel_path:
                db.update_asset_path(rel_path, target_rel_path, conn=conn)
            db.delete_items_by_file_path(rel_path, conn=conn)
            db.insert_items(new_item_dicts, conn=conn)
            conn.commit()

        self.item_service.clear_item_cache()
        with self.session.state_lock:
            self.session.asset_decompress_cache.pop(rel_path, None)
            if target_rel_path != rel_path:
                self.session.asset_decompress_cache.pop(target_rel_path, None)

        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(
            rel_paths=(target_rel_path,),
            removed_rel_paths=(
                (rel_path,)
                if target_rel_path.casefold() != rel_path.casefold()
                else ()
            ),
            matched=matched,
            new=max(0, len(new_item_dicts) - matched),
            total=len(new_item_dicts),
        )

    def reset_file(self, rel_path: str) -> ProjectFileMutationResult:
        """把指定文件下的译文状态整体重置。"""

        db = self.get_loaded_db()
        items = db.get_items_by_file_path(rel_path)
        for item in GapTool.iter(items):
            item["dst"] = ""
            item["name_dst"] = None
            item["status"] = Base.ProjectStatus.NONE
            item["retry_count"] = 0

        if items:
            db.update_batch(items=items)

        self.item_service.clear_item_cache()
        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(
            rel_paths=(rel_path,),
            matched=len(items),
            total=len(items),
        )

    def delete_file(self, rel_path: str) -> ProjectFileMutationResult:
        """删除工程内文件及其条目。"""

        db = self.get_loaded_db()
        with db.connection() as conn:
            db.delete_items_by_file_path(rel_path, conn=conn)
            db.delete_asset(rel_path, conn=conn)
            conn.commit()

        self.item_service.clear_item_cache()
        with self.session.state_lock:
            self.session.asset_decompress_cache.pop(rel_path, None)
        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(removed_rel_paths=(rel_path,))

    def reset_file_batch(self, rel_paths: list[str]) -> ProjectFileMutationResult:
        """批量重置多个文件下的译文状态。"""

        normalized_rel_paths = self.normalize_batch_rel_paths(rel_paths)
        db = self.get_loaded_db()
        all_items: list[dict[str, Any]] = []

        for rel_path in GapTool.iter(normalized_rel_paths):
            items = db.get_items_by_file_path(rel_path)
            for item in GapTool.iter(items):
                item["dst"] = ""
                item["name_dst"] = None
                item["status"] = Base.ProjectStatus.NONE
                item["retry_count"] = 0
            all_items.extend(items)

        if all_items:
            db.update_batch(items=all_items)

        self.item_service.clear_item_cache()
        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(
            rel_paths=tuple(normalized_rel_paths),
            matched=len(all_items),
            total=len(all_items),
        )

    def delete_file_batch(self, rel_paths: list[str]) -> ProjectFileMutationResult:
        """批量删除多个工程文件及其条目。"""

        normalized_rel_paths = self.normalize_batch_rel_paths(rel_paths)
        db = self.get_loaded_db()

        with db.connection() as conn:
            for rel_path in GapTool.iter(normalized_rel_paths):
                db.delete_items_by_file_path(rel_path, conn=conn)
                db.delete_asset(rel_path, conn=conn)
            conn.commit()

        self.item_service.clear_item_cache()
        with self.session.state_lock:
            for rel_path in GapTool.iter(normalized_rel_paths):
                self.session.asset_decompress_cache.pop(rel_path, None)
        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(
            removed_rel_paths=tuple(normalized_rel_paths),
        )

    def replace_file_batch(
        self,
        operations: list[tuple[str, str]],
    ) -> ProjectFileMutationResult:
        """批量替换多个工程文件，并在一次事务内提交。"""

        normalized_operations = self.normalize_replace_operations(operations)
        db = self.get_loaded_db()
        existing_paths = db.get_all_asset_paths()
        existing_path_casefolds = {path.casefold() for path in existing_paths}
        source_path_casefolds = {rel_path.casefold() for rel_path, _ in normalized_operations}
        target_path_casefolds: set[str] = set()
        prepared_operations: list[dict[str, Any]] = []

        for rel_path, new_file_path in GapTool.iter(normalized_operations):
            if rel_path.casefold() not in existing_path_casefolds:
                raise ValueError(Localizer.get().workbench_msg_file_not_found)

            target_rel_path = self.build_replace_target_rel_path(rel_path, new_file_path)
            if target_rel_path.casefold() == rel_path.casefold():
                target_rel_path = rel_path

            if (
                target_rel_path.casefold() in source_path_casefolds
                and target_rel_path.casefold() != rel_path.casefold()
            ):
                raise ValueError(Localizer.get().workbench_msg_replace_name_conflict)
            if target_rel_path.casefold() in target_path_casefolds:
                raise ValueError(Localizer.get().workbench_msg_replace_name_conflict)

            old_items = db.get_items_by_file_path(rel_path)
            with open(new_file_path, "rb") as f:
                original_data = f.read()

            from module.File.FileManager import FileManager

            file_manager = FileManager(Config().load())
            new_items = file_manager.parse_asset(target_rel_path, original_data)
            new_item_dicts: list[dict[str, Any]] = []
            for item in GapTool.iter(new_items):
                new_item_dicts.append(item.to_dict())

            old_type = self.pick_file_type(old_items)
            new_type = self.pick_file_type(new_item_dicts)
            if old_type != new_type:
                raise ValueError(Localizer.get().workbench_msg_replace_format_mismatch)

            if target_rel_path.casefold() != rel_path.casefold():
                self.ensure_replace_target_path_not_conflict(
                    existing_paths,
                    rel_path,
                    target_rel_path,
                )

            matched = self.inherit_completed_translations(old_items, new_item_dicts)
            prepared_operations.append(
                {
                    "rel_path": rel_path,
                    "target_rel_path": target_rel_path,
                    "original_data": original_data,
                    "new_item_dicts": new_item_dicts,
                    "matched": matched,
                }
            )
            target_path_casefolds.add(target_rel_path.casefold())

        with db.connection() as conn:
            for operation in GapTool.iter(prepared_operations):
                rel_path = str(operation["rel_path"])
                target_rel_path = str(operation["target_rel_path"])
                original_data = bytes(operation["original_data"])
                new_item_dicts = list(operation["new_item_dicts"])

                db.update_asset(
                    rel_path,
                    ZstdTool.compress(original_data),
                    len(original_data),
                    conn=conn,
                )
                if target_rel_path != rel_path:
                    db.update_asset_path(rel_path, target_rel_path, conn=conn)
                db.delete_items_by_file_path(rel_path, conn=conn)
                db.insert_items(new_item_dicts, conn=conn)
            conn.commit()

        self.item_service.clear_item_cache()
        with self.session.state_lock:
            for operation in GapTool.iter(prepared_operations):
                rel_path = str(operation["rel_path"])
                target_rel_path = str(operation["target_rel_path"])
                self.session.asset_decompress_cache.pop(rel_path, None)
                if target_rel_path != rel_path:
                    self.session.asset_decompress_cache.pop(target_rel_path, None)

        self.analysis_service.clear_analysis_progress()
        return ProjectFileMutationResult(
            rel_paths=tuple(
                str(operation["target_rel_path"])
                for operation in GapTool.iter(prepared_operations)
            ),
            removed_rel_paths=tuple(
                str(operation["rel_path"])
                for operation in GapTool.iter(prepared_operations)
                if str(operation["target_rel_path"]).casefold()
                != str(operation["rel_path"]).casefold()
            ),
            matched=sum(int(operation["matched"]) for operation in prepared_operations),
            new=sum(
                max(
                    0,
                    len(list(operation["new_item_dicts"])) - int(operation["matched"]),
                )
                for operation in prepared_operations
            ),
            total=sum(len(list(operation["new_item_dicts"])) for operation in prepared_operations),
        )

    def reorder_files(self, ordered_rel_paths: list[str]) -> ProjectFileMutationResult:
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
        return ProjectFileMutationResult(order_changed=True)

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
        for rel_path in GapTool.iter(rel_paths):
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

    def normalize_replace_operations(
        self,
        operations: list[tuple[str, str]],
    ) -> list[tuple[str, str]]:
        """规范化批量替换操作，避免重复源路径混入同一批。"""

        normalized_operations: list[tuple[str, str]] = []
        seen_rel_paths: set[str] = set()

        for rel_path, new_file_path in GapTool.iter(operations):
            normalized_rel_path = str(rel_path).strip()
            normalized_file_path = str(new_file_path).strip()
            if normalized_rel_path == "" or normalized_file_path == "":
                raise ValueError("工作台文件路径无效")

            normalized_key = normalized_rel_path.casefold()
            if normalized_key in seen_rel_paths:
                raise ValueError("工作台文件路径无效")
            seen_rel_paths.add(normalized_key)
            normalized_operations.append((normalized_rel_path, normalized_file_path))

        if not normalized_operations:
            raise ValueError("工作台文件路径无效")

        return normalized_operations

    def pick_file_type(self, items: list[dict[str, Any]]) -> str:
        """从条目列表里挑出有效文件类型。"""

        for item in GapTool.iter(items):
            raw_type = item.get("file_type")
            if isinstance(raw_type, Item.FileType):
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

    def inherit_completed_translations(
        self,
        old_items: list[dict[str, Any]],
        new_item_dicts: list[dict[str, Any]],
    ) -> int:
        """按 src 继承旧文件中的完成态译文。"""

        src_seen_order: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in GapTool.iter(old_items):
            src = item.get("src")
            if isinstance(src, str):
                src_seen_order[src].append(item)

        src_best: dict[str, dict[str, Any]] = {}
        for src, candidates in src_seen_order.items():
            dst_count: dict[str, int] = {}
            first_index: dict[str, int] = {}
            first_item: dict[str, dict[str, Any]] = {}
            for idx, candidate in enumerate(candidates):
                dst = candidate.get("dst")
                dst_key = dst if isinstance(dst, str) else ""
                dst_count[dst_key] = dst_count.get(dst_key, 0) + 1
                if dst_key not in first_index:
                    first_index[dst_key] = idx
                    first_item[dst_key] = candidate

            best_dst = min(
                dst_count,
                key=lambda text: (-dst_count[text], first_index.get(text, 10**9)),
            )
            src_best[src] = first_item[best_dst]

        inheritable_statuses = {
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        }
        structural_statuses = {
            Base.ProjectStatus.EXCLUDED,
            Base.ProjectStatus.RULE_SKIPPED,
            Base.ProjectStatus.LANGUAGE_SKIPPED,
            Base.ProjectStatus.DUPLICATED,
        }

        matched = 0
        for item in GapTool.iter(new_item_dicts):
            src = item.get("src")
            if not isinstance(src, str):
                continue

            old_item = src_best.get(src)
            if old_item is None:
                continue

            old_status = self.normalize_status(
                old_item.get("status", Base.ProjectStatus.NONE)
            )
            if old_status in inheritable_statuses:
                item["dst"] = old_item.get("dst", "")
                item["name_dst"] = old_item.get("name_dst")
                item["retry_count"] = old_item.get("retry_count", 0)

                new_status = self.normalize_status(
                    item.get("status", Base.ProjectStatus.NONE)
                )
                if new_status not in structural_statuses:
                    item["status"] = old_status

            matched += 1

        return matched

    def normalize_status(self, raw_status: object) -> Base.ProjectStatus:
        """把状态统一规整成枚举。"""

        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return Base.ProjectStatus.NONE
        return Base.ProjectStatus.NONE
