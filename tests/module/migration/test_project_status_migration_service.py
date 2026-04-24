import sqlite3

from module.Migration.ProjectStatusMigrationService import ProjectStatusMigrationService
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


def read_items(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT data FROM items ORDER BY id").fetchall()
    return [JSONTool.loads(row["data"]) for row in rows]


def test_migrate_rewrites_legacy_item_status_and_project_status_meta() -> None:
    conn = create_connection()
    conn.execute(
        "INSERT INTO items (data) VALUES (?)",
        (
            JSONTool.dumps(
                {
                    "src": "old",
                    "dst": "done",
                    "status": "PROCESSED_IN_PAST",
                    "extra_field": {"keep": True},
                }
            ),
        ),
    )
    conn.execute(
        "INSERT INTO items (data) VALUES (?)",
        (JSONTool.dumps({"src": "new", "status": "NONE"}),),
    )
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        ("project_status", JSONTool.dumps("PROCESSED_IN_PAST")),
    )

    changed = ProjectStatusMigrationService.migrate(conn)

    assert changed is True
    assert read_items(conn) == [
        {
            "src": "old",
            "dst": "done",
            "status": "PROCESSED",
            "extra_field": {"keep": True},
        },
        {"src": "new", "status": "NONE"},
    ]
    row = conn.execute(
        "SELECT value FROM meta WHERE key = ?",
        ("project_status",),
    ).fetchone()
    assert JSONTool.loads(row["value"]) == "PROCESSED"


def test_migrate_is_idempotent_after_first_rewrite() -> None:
    conn = create_connection()
    conn.execute(
        "INSERT INTO items (data) VALUES (?)",
        (JSONTool.dumps({"src": "old", "status": "PROCESSED_IN_PAST"}),),
    )

    first_changed = ProjectStatusMigrationService.migrate(conn)
    second_changed = ProjectStatusMigrationService.migrate(conn)

    assert first_changed is True
    assert second_changed is False
    assert read_items(conn) == [{"src": "old", "status": "PROCESSED"}]


def test_migrate_leaves_other_fields_and_statuses_untouched() -> None:
    conn = create_connection()
    conn.execute(
        "INSERT INTO items (data) VALUES (?)",
        (JSONTool.dumps({"src": "todo", "status": "NONE", "tag": "keep"}),),
    )
    conn.execute(
        "INSERT INTO items (data) VALUES (?)",
        (JSONTool.dumps({"src": "done", "status": "PROCESSED"}),),
    )
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        ("project_status", JSONTool.dumps("PROCESSING")),
    )

    changed = ProjectStatusMigrationService.migrate(conn)

    assert changed is False
    assert read_items(conn) == [
        {"src": "todo", "status": "NONE", "tag": "keep"},
        {"src": "done", "status": "PROCESSED"},
    ]
    row = conn.execute(
        "SELECT value FROM meta WHERE key = ?",
        ("project_status",),
    ).fetchone()
    assert JSONTool.loads(row["value"]) == "PROCESSING"
