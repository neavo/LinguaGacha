from __future__ import annotations

import sqlite3
from typing import Any

from base.LogManager import LogManager
from module.Utils.JSONTool import JSONTool


class ProjectStatusMigrationService:
    """统一承接项目状态旧值向当前状态域的迁移。"""

    LEGACY_PROCESSED_IN_PAST: str = "PROCESSED_IN_PAST"
    CURRENT_PROCESSED: str = "PROCESSED"
    PROJECT_STATUS_META_KEY: str = "project_status"

    @classmethod
    def normalize_status_value(cls, value: Any) -> Any:
        """把旧状态值转成当前值，未知值交给调用方按自身语义处理。"""

        raw_value = getattr(value, "value", value)
        if raw_value == cls.LEGACY_PROCESSED_IN_PAST:
            return cls.CURRENT_PROCESSED
        return raw_value

    @classmethod
    def migrate(cls, conn: sqlite3.Connection) -> bool:
        """把旧工程中已持久化的历史完成状态归一到已处理。"""

        items_changed = cls.migrate_item_statuses(conn)
        meta_changed = cls.migrate_project_status_meta(conn)
        return items_changed or meta_changed

    @classmethod
    def migrate_item_statuses(cls, conn: sqlite3.Connection) -> bool:
        """扫描 items.data JSON，只改写 status 旧值并保留其他字段。"""

        changed = False
        rows = conn.execute("SELECT id, data FROM items ORDER BY id").fetchall()
        for row in rows:
            item_id = int(row["id"])
            raw_data = str(row["data"])
            try:
                item_data = JSONTool.loads(raw_data)
            except Exception as e:
                LogManager.get().warning(
                    f"Failed to migrate legacy project status item: id={item_id}",
                    e,
                )
                continue

            if not isinstance(item_data, dict):
                continue
            if item_data.get("status") != cls.LEGACY_PROCESSED_IN_PAST:
                continue

            normalized_data: dict[str, Any] = dict(item_data)
            normalized_data["status"] = cls.CURRENT_PROCESSED
            conn.execute(
                "UPDATE items SET data = ? WHERE id = ?",
                (JSONTool.dumps(normalized_data), item_id),
            )
            changed = True

        return changed

    @classmethod
    def migrate_project_status_meta(cls, conn: sqlite3.Connection) -> bool:
        """同步迁移极端旧工程里 meta.project_status 的旧状态。"""

        row = conn.execute(
            "SELECT value FROM meta WHERE key = ?",
            (cls.PROJECT_STATUS_META_KEY,),
        ).fetchone()
        if row is None:
            return False

        try:
            raw_status = JSONTool.loads(row["value"])
        except Exception as e:
            LogManager.get().warning(
                "Failed to migrate legacy project status meta",
                e,
            )
            return False

        if raw_status != cls.LEGACY_PROCESSED_IN_PAST:
            return False

        conn.execute(
            "UPDATE meta SET value = ? WHERE key = ?",
            (
                JSONTool.dumps(cls.CURRENT_PROCESSED),
                cls.PROJECT_STATUS_META_KEY,
            ),
        )
        return True
