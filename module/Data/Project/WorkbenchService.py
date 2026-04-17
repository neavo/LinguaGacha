from __future__ import annotations

from collections import defaultdict
from typing import Any

from base.Base import Base
from model.Item import Item
from module.Data.Core.DataTypes import WorkbenchFileEntrySnapshot
from module.Data.Core.DataTypes import WorkbenchSnapshot
from module.Utils.GapTool import GapTool


class WorkbenchService:
    """工作台聚合服务。"""

    COUNTED_STATUSES = {
        Base.ProjectStatus.NONE,
        Base.ProjectStatus.PROCESSING,
        Base.ProjectStatus.PROCESSED,
        Base.ProjectStatus.PROCESSED_IN_PAST,
        Base.ProjectStatus.ERROR,
    }
    TRANSLATED_STATUSES = {
        Base.ProjectStatus.PROCESSED,
        Base.ProjectStatus.PROCESSED_IN_PAST,
    }

    def build_snapshot(
        self,
        asset_paths: list[str],
        item_dicts: list[dict[str, Any]],
    ) -> WorkbenchSnapshot:
        """把资产列表和条目列表聚合成工作台快照。"""

        total_items = 0
        translated = 0
        translated_in_past = 0
        error_count = 0
        count_by_path: dict[str, int] = defaultdict(int)
        file_type_by_path: dict[str, Item.FileType] = {}

        for item in GapTool.iter(item_dicts):
            rel_path = item.get("file_path")
            if not isinstance(rel_path, str) or rel_path == "":
                continue

            if rel_path not in file_type_by_path:
                raw_type = item.get("file_type")
                if isinstance(raw_type, Item.FileType):
                    file_type_by_path[rel_path] = raw_type
                elif isinstance(raw_type, str) and raw_type != "":
                    try:
                        file_type_by_path[rel_path] = Item.FileType(raw_type)
                    except ValueError:
                        file_type_by_path[rel_path] = Item.FileType.NONE

            status = self.normalize_status(item.get("status", Base.ProjectStatus.NONE))
            if status not in self.COUNTED_STATUSES:
                continue

            total_items += 1
            count_by_path[rel_path] += 1
            if status in self.TRANSLATED_STATUSES:
                translated += 1
            elif status == Base.ProjectStatus.ERROR:
                error_count += 1

            if status == Base.ProjectStatus.PROCESSED_IN_PAST:
                translated_in_past += 1

        entries: list[WorkbenchFileEntrySnapshot] = []
        for rel_path in GapTool.iter(asset_paths):
            entries.append(
                WorkbenchFileEntrySnapshot(
                    rel_path=rel_path,
                    item_count=count_by_path.get(rel_path, 0),
                    file_type=file_type_by_path.get(rel_path, Item.FileType.NONE),
                )
            )

        return WorkbenchSnapshot(
            file_count=len(asset_paths),
            total_items=total_items,
            translated=translated,
            translated_in_past=translated_in_past,
            error_count=error_count,
            untranslated=max(0, total_items - translated - error_count),
            entries=tuple(entries),
        )

    def normalize_status(self, raw_status: object) -> Base.ProjectStatus:
        """把条目状态规整成枚举。"""

        if isinstance(raw_status, Base.ProjectStatus):
            return raw_status
        if isinstance(raw_status, str):
            try:
                return Base.ProjectStatus(raw_status)
            except ValueError:
                return Base.ProjectStatus.NONE
        return Base.ProjectStatus.NONE
