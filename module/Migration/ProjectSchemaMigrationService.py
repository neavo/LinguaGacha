from __future__ import annotations

import sqlite3
from collections.abc import Callable


class ProjectSchemaMigrationService:
    """统一编排 .lg 打开阶段的写回型迁移。"""

    @classmethod
    def migrate(
        cls,
        conn: sqlite3.Connection,
        migrate_asset_sort_order_schema: Callable[[sqlite3.Connection], bool],
        migrate_project_status_schema: Callable[[sqlite3.Connection], bool],
    ) -> bool:
        """执行 schema 迁移入口；具体 SQL 仍由 storage 层提供。"""

        asset_schema_changed = migrate_asset_sort_order_schema(conn)
        status_changed = migrate_project_status_schema(conn)
        return asset_schema_changed or status_changed
