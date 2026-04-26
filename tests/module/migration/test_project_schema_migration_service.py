import contextlib
import sqlite3

from module.Migration.ProjectSchemaMigrationService import ProjectSchemaMigrationService
from module.Utils.JSONTool import JSONTool


def create_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data TEXT NOT NULL
        )
        """
    )
    return conn


def test_migrate_runs_storage_schema_hook_and_project_status_migration() -> None:
    with contextlib.closing(create_connection()) as conn:
        conn.execute(
            "INSERT INTO items (data) VALUES (?)",
            (JSONTool.dumps({"src": "old", "status": "PROCESSED_IN_PAST"}),),
        )
        called = False

        def migrate_asset_sort_order_schema(target_conn: sqlite3.Connection) -> bool:
            nonlocal called
            called = target_conn is conn
            return True

        def migrate_project_status_schema(target_conn: sqlite3.Connection) -> bool:
            row = target_conn.execute("SELECT data FROM items WHERE id = 1").fetchone()
            item_data = JSONTool.loads(row["data"])
            item_data["status"] = "PROCESSED"
            target_conn.execute(
                "UPDATE items SET data = ? WHERE id = 1",
                (JSONTool.dumps(item_data),),
            )
            return True

        changed = ProjectSchemaMigrationService.migrate(
            conn,
            migrate_asset_sort_order_schema,
            migrate_project_status_schema,
        )

        row = conn.execute("SELECT data FROM items WHERE id = 1").fetchone()
        assert changed is True
        assert called is True
        assert JSONTool.loads(row["data"])["status"] == "PROCESSED"


def test_migrate_reports_unchanged_when_no_schema_or_status_rewrite_needed() -> None:
    with contextlib.closing(create_connection()) as conn:
        conn.execute(
            "INSERT INTO items (data) VALUES (?)",
            (JSONTool.dumps({"src": "current", "status": "PROCESSED"}),),
        )

        changed = ProjectSchemaMigrationService.migrate(
            conn,
            lambda target_conn: False,
            lambda target_conn: False,
        )

        assert changed is False
