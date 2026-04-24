from collections.abc import Generator
import contextlib
from pathlib import Path
import sqlite3
import shutil
from typing import cast
from unittest.mock import MagicMock

import pytest

import module.Data.Storage.LGDatabase as lg_database_module
from module.Data.Storage.LGDatabase import LGDatabase


class FakeLogManager:
    def __init__(self) -> None:
        self.warning_messages: list[str] = []
        self.warning_exceptions: list[BaseException | None] = []

    def warning(self, msg: str, e: BaseException | None = None) -> None:
        self.warning_messages.append(msg)
        self.warning_exceptions.append(e)


@pytest.fixture(autouse=True)
def install_fake_log_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[FakeLogManager, None, None]:
    # 这个文件会主动覆盖坏数据与兼容路径，测试时不需要真实 Rich 日志刷到控制台。
    logger = FakeLogManager()
    monkeypatch.setattr(lg_database_module.LogManager, "get", lambda: logger)
    yield logger


@pytest.fixture
def database() -> Generator[LGDatabase, None, None]:
    db = LGDatabase(":memory:")
    db.open()
    try:
        yield db
    finally:
        db.close()


@contextlib.contextmanager
def real_db_path(fs, case_name: str) -> Generator[Path, None, None]:
    """为需要真实 SQLite 文件的场景提供受控路径。"""

    fs.pause()
    root_path = Path.cwd() / ".tmp_pytest_lg_database"
    case_path = root_path / case_name
    db_path = case_path / f"{case_name}.lg"
    try:
        case_path.mkdir(parents=True, exist_ok=True)
        yield db_path
    finally:
        shutil.rmtree(case_path, ignore_errors=True)
        with contextlib.suppress(OSError):
            root_path.rmdir()
        fs.resume()


def test_memory_mode_supports_open_close_and_crud() -> None:
    db = LGDatabase(":memory:")
    db.open()
    try:
        db.set_meta("project", {"name": "demo"})
        item_id = db.set_item({"src": "a", "dst": "b"})
        assert db.get_meta("project") == {"name": "demo"}
        assert db.get_all_items() == [{"id": item_id, "src": "a", "dst": "b"}]
    finally:
        db.close()

    assert db.keep_alive_conn is None


def test_meta_roundtrip_and_default(database: LGDatabase) -> None:
    assert database.get_meta("missing", "fallback") == "fallback"

    database.set_meta("project_name", {"name": "demo"})

    assert database.get_meta("project_name") == {"name": "demo"}


def test_get_all_meta_returns_all_keys(database: LGDatabase) -> None:
    database.set_meta("k1", 1)
    database.set_meta("k2", {"v": 2})

    meta = database.get_all_meta()

    assert meta["k1"] == 1
    assert meta["k2"] == {"v": 2}


def test_set_item_insert_update_and_get_all_items(database: LGDatabase) -> None:
    item_id = database.set_item({"src": "hello", "dst": "你好"})

    database.set_item({"id": item_id, "src": "hello", "dst": "您好"})
    items = database.get_all_items()

    assert items == [{"id": item_id, "src": "hello", "dst": "您好"}]


def test_set_items_replaces_all_and_preserves_given_ids(database: LGDatabase) -> None:
    database.set_item({"src": "old"})

    ids = database.set_items(
        [
            {"id": 7, "src": "first", "dst": "一"},
            {"src": "second", "dst": "二"},
        ]
    )
    items = database.get_all_items()

    assert ids[0] == 7
    assert items[0] == {"id": 7, "src": "first", "dst": "一"}
    assert items[1]["src"] == "second"
    assert items[1]["dst"] == "二"


def test_preview_replace_all_item_ids_follows_sequence_and_explicit_ids(
    database: LGDatabase,
) -> None:
    database.set_item({"src": "old-a"})
    database.set_item({"src": "old-b"})

    preview_ids = database.preview_replace_all_item_ids(
        [
            {"src": "first"},
            {"id": 9, "src": "second"},
            {"src": "third"},
        ]
    )

    assert preview_ids == [3, 9, 10]


def test_update_batch_updates_items_rules_and_meta(database: LGDatabase) -> None:
    item_id = database.set_item({"src": "before", "dst": "old"})

    database.update_batch(
        items=[{"id": item_id, "src": "after", "dst": "new"}],
        rules={
            LGDatabase.RuleType.GLOSSARY: [
                {"src": "HP", "dst": "生命值", "info": "", "regex": False}
            ]
        },
        meta={"source_language": "JA", "target_language": "ZH"},
    )

    assert database.get_all_items() == [{"id": item_id, "src": "after", "dst": "new"}]
    assert database.get_rules(LGDatabase.RuleType.GLOSSARY) == [
        {"src": "HP", "dst": "生命值", "info": "", "regex": False}
    ]
    assert database.get_meta("source_language") == "JA"
    assert database.get_meta("target_language") == "ZH"


def test_get_rules_supports_legacy_multi_row_format(database: LGDatabase) -> None:
    with database.connection() as conn:
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, '{"src":"A","dst":"甲"}'),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, '[{"src":"B","dst":"乙"}]'),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, "not-json"),
        )
        conn.commit()

    assert database.get_rules(LGDatabase.RuleType.PRE_REPLACEMENT) == [
        {"src": "A", "dst": "甲"},
        {"src": "B", "dst": "乙"},
    ]


def test_get_rules_logs_and_returns_empty_when_first_row_is_invalid_json(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    logger = MagicMock()
    monkeypatch.setattr("module.Data.Storage.LGDatabase.LogManager.get", lambda: logger)

    with database.connection() as conn:
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.GLOSSARY, "not-json"),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.GLOSSARY, '{"src":"A","dst":"B"}'),
        )
        conn.commit()

    assert database.get_rules(LGDatabase.RuleType.GLOSSARY) == []
    logger.warning.assert_called_once()


def test_get_project_summary_uses_translation_extras(database: LGDatabase) -> None:
    database.set_meta("name", "MyProject")
    database.set_meta("source_language", "JP")
    database.set_meta("target_language", "ZH")
    database.set_meta("translation_extras", {"line": 4, "total_line": 5})
    database.set_item({"src": "1"})
    database.set_item({"src": "2"})
    database.add_asset("a.txt", b"1", 1)

    summary = database.get_project_summary()

    assert summary["name"] == "MyProject"
    assert summary["source_language"] == "JP"
    assert summary["target_language"] == "ZH"
    assert summary["file_count"] == 1
    assert summary["translated_items"] == 4
    assert summary["total_items"] == 5
    assert summary["progress"] == 0.8


def test_get_project_summary_falls_back_to_item_count_when_extras_missing_or_invalid(
    database: LGDatabase,
) -> None:
    database.set_meta("translation_extras", [])
    database.set_item({"src": "1"})
    database.set_item({"src": "2"})

    summary = database.get_project_summary()
    assert summary["total_items"] == 2
    assert summary["translated_items"] == 0
    assert summary["progress"] == 0.0


def test_get_project_summary_uses_item_count_when_total_line_is_zero(
    database: LGDatabase,
) -> None:
    database.set_meta("translation_extras", {"line": 4, "total_line": 0})
    for i in range(10):
        database.set_item({"src": str(i)})

    summary = database.get_project_summary()
    assert summary["translated_items"] == 4
    assert summary["total_items"] == 10
    assert summary["progress"] == 0.4


def test_get_project_summary_returns_zero_progress_when_no_items(
    database: LGDatabase,
) -> None:
    database.set_meta("translation_extras", {"line": 1, "total_line": 0})

    summary = database.get_project_summary()
    assert summary["total_items"] == 0
    assert summary["progress"] == 0.0


def test_create_creates_persistent_db_file_and_sets_base_meta(fs) -> None:
    with real_db_path(fs, "create") as db_path:
        db = LGDatabase.create(str(db_path), "Demo")

        assert db.keep_alive_conn is None
        assert db_path.exists() is True
        assert db.get_meta("name") == "Demo"
        assert db.get_meta("schema_version") == LGDatabase.SCHEMA_VERSION
        assert isinstance(db.get_meta("created_at"), str)
        assert isinstance(db.get_meta("updated_at"), str)


def test_add_asset_and_get_asset_roundtrip(database: LGDatabase) -> None:
    asset_id = database.add_asset("a.bin", b"raw-data", original_size=8)

    assert isinstance(asset_id, int)
    assert database.get_asset("a.bin") == b"raw-data"
    assert database.get_asset("missing.bin") is None


def test_get_all_asset_paths_preserves_insert_order(
    database: LGDatabase,
) -> None:
    database.add_asset("a.txt", b"1", 1)
    database.add_asset("b.txt", b"2", 1)

    assert database.get_all_asset_paths() == ["a.txt", "b.txt"]

    # 更新路径不应改变展示顺序（按 id 排序）。
    database.update_asset_path("a.txt", "c.txt")
    assert database.get_all_asset_paths() == ["c.txt", "b.txt"]


def test_add_asset_appends_after_reordered_sort_order(database: LGDatabase) -> None:
    database.add_asset("a.txt", b"1", 1)
    database.add_asset("b.txt", b"2", 1)
    database.update_asset_sort_orders(["b.txt", "a.txt"])

    database.add_asset("c.txt", b"3", 1)

    assert database.get_all_asset_paths() == ["b.txt", "a.txt", "c.txt"]


def test_connection_reuses_keep_alive_connection(database: LGDatabase) -> None:
    database.open()
    try:
        with database.connection() as first:
            with database.connection() as second:
                assert first is second
    finally:
        database.close()


def test_ensure_schema_noops_when_no_connection_available() -> None:
    db = LGDatabase(":memory:")
    # 未 open 时不应抛异常。
    db.ensure_schema()


def test_short_connection_context_creates_schema_and_closes(fs) -> None:
    with real_db_path(fs, "short_connection") as db_path:
        db = LGDatabase(str(db_path))

        with db.connection() as conn:
            names = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            assert {"meta", "assets", "items", "rules"}.issubset(names)

        with pytest.raises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")


def test_ensure_schema_backfills_asset_sort_order_for_legacy_db(fs) -> None:
    with real_db_path(fs, "legacy_sort_order") as db_path:
        if db_path.exists():
            db_path.unlink()
        with contextlib.closing(sqlite3.connect(db_path)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    data BLOB NOT NULL,
                    original_size INTEGER NOT NULL,
                    compressed_size INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO assets (path, data, original_size, compressed_size)
                VALUES ('b.txt', X'31', 1, 1)
                """
            )
            conn.execute(
                """
                INSERT INTO assets (path, data, original_size, compressed_size)
                VALUES ('a.txt', X'32', 1, 1)
                """
            )
            conn.commit()

        db = LGDatabase(str(db_path))
        db.open()
        try:
            with db.connection() as conn:
                rows = conn.execute(
                    "SELECT path, sort_order FROM assets ORDER BY sort_order ASC, id ASC"
                ).fetchall()
            assert [(row["path"], row["sort_order"]) for row in rows] == [
                ("b.txt", 0),
                ("a.txt", 1),
            ]
        finally:
            db.close()


def test_get_and_set_rule_text_roundtrip(database: LGDatabase) -> None:
    assert database.get_rule_text(LGDatabase.RuleType.TRANSLATION_PROMPT) == ""

    database.set_rule_text(LGDatabase.RuleType.TRANSLATION_PROMPT, "prompt")

    assert database.get_rule_text(LGDatabase.RuleType.TRANSLATION_PROMPT) == "prompt"


def test_get_rule_text_by_name_supports_legacy_string_payload(
    database: LGDatabase,
) -> None:
    with database.connection() as conn:
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE, '"Old English prompt"'),
        )
        conn.commit()

    assert (
        database.get_rule_text_by_name(
            LGDatabase.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE
        )
        == "Old English prompt"
    )


class FakeConn:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def execute(self, sql: str, params: tuple = ()):
        if "json_extract" in sql:
            raise sqlite3.OperationalError("no such function: json_extract")
        return self.conn.execute(sql, params)

    def commit(self) -> None:
        self.conn.commit()


class CursorWithoutLastRowId:
    def __init__(self) -> None:
        self.lastrowid = None


class NoLastRowIdConn:
    def execute(self, sql: str, params: tuple = ()) -> CursorWithoutLastRowId:
        _ = sql
        _ = params
        return CursorWithoutLastRowId()

    def commit(self) -> None:
        return


class JsonExtractErrorConn:
    def __init__(self, message: str) -> None:
        self.message = message

    def execute(self, sql: str, params: tuple = ()):
        _ = params
        if "json_extract" in sql:
            raise sqlite3.OperationalError(self.message)
        raise AssertionError("unexpected sql")

    def commit(self) -> None:
        return


def test_delete_items_by_file_path_removes_matching_items(database: LGDatabase) -> None:
    database.set_item({"src": "a1", "file_path": "a.txt"})
    id_b1 = database.set_item({"src": "b1", "file_path": "b.txt"})
    database.set_item({"src": "a2", "file_path": "a.txt"})

    deleted = database.delete_items_by_file_path("a.txt")

    assert deleted == 2
    assert database.get_all_items() == [
        {"id": id_b1, "src": "b1", "file_path": "b.txt"}
    ]


def test_delete_items_by_file_path_falls_back_when_json_extract_missing_with_conn(
    database: LGDatabase,
) -> None:
    database.set_item({"src": "a1", "file_path": "a.txt"})
    id_b1 = database.set_item({"src": "b1", "file_path": "b.txt"})
    database.set_item({"src": "a2", "file_path": "a.txt"})
    assert database.keep_alive_conn is not None

    fake = FakeConn(database.keep_alive_conn)
    deleted = database.delete_items_by_file_path(
        "a.txt", conn=cast(sqlite3.Connection, fake)
    )
    fake.commit()

    assert deleted == 2
    assert database.get_all_items() == [
        {"id": id_b1, "src": "b1", "file_path": "b.txt"}
    ]


def test_delete_items_by_file_path_falls_back_when_json_extract_missing_without_conn(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    database.set_item({"src": "a1", "file_path": "a.txt"})
    id_b1 = database.set_item({"src": "b1", "file_path": "b.txt"})
    database.set_item({"src": "a2", "file_path": "a.txt"})
    assert database.keep_alive_conn is not None

    fake = FakeConn(database.keep_alive_conn)

    @contextlib.contextmanager
    def fake_connection():
        yield fake

    monkeypatch.setattr(database, "connection", fake_connection)

    deleted = database.delete_items_by_file_path("a.txt")
    fake.commit()

    assert deleted == 2
    assert database.get_all_items() == [
        {"id": id_b1, "src": "b1", "file_path": "b.txt"}
    ]


def test_update_asset_path_renames_asset_record(database: LGDatabase) -> None:
    database.add_asset("a.txt", b"raw", original_size=3)

    updated = database.update_asset_path("a.txt", "b.txt")

    assert updated == 1
    assert database.asset_path_exists("a.txt") is False
    assert database.asset_path_exists("b.txt") is True


def test_delete_asset_removes_record(database: LGDatabase) -> None:
    database.add_asset("a.bin", b"v1", original_size=2)
    assert database.get_asset("a.bin") == b"v1"

    database.delete_asset("a.bin")

    assert database.get_asset("a.bin") is None


def test_update_asset_replaces_data(database: LGDatabase) -> None:
    database.add_asset("a.bin", b"v1", original_size=2)

    database.update_asset("a.bin", b"v2", original_size=2)

    assert database.get_asset("a.bin") == b"v2"


def test_update_asset_path_update_asset_and_delete_asset_support_conn_param(
    fs,
) -> None:
    with real_db_path(fs, "conn_param") as db_path:
        db = LGDatabase(str(db_path))
        try:
            db.add_asset("a.bin", b"v1", 2)

            with db.connection() as conn:
                db.update_asset("a.bin", b"v2", 2, conn=conn)
                conn.commit()
                assert db.get_asset("a.bin") == b"v2"

                assert db.update_asset_path("a.bin", "b.bin", conn=conn) == 1
                conn.commit()
                assert db.get_asset("b.bin") == b"v2"

                db.delete_asset("b.bin", conn=conn)
                conn.commit()
                assert db.get_asset("b.bin") is None
        finally:
            db.close()


def test_asset_path_exists_returns_correct_bool(database: LGDatabase) -> None:
    assert database.asset_path_exists("a.bin") is False

    database.add_asset("a.bin", b"raw", original_size=3)

    assert database.asset_path_exists("a.bin") is True


def test_add_asset_raises_when_cursor_has_no_lastrowid(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_conn = NoLastRowIdConn()

    @contextlib.contextmanager
    def fake_connection() -> Generator[NoLastRowIdConn, None, None]:
        yield fake_conn

    monkeypatch.setattr(database, "connection", fake_connection)

    with pytest.raises(ValueError, match="Failed to get lastrowid"):
        database.add_asset("a.bin", b"raw", original_size=3)


def test_set_item_raises_when_insert_cursor_has_no_lastrowid(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_conn = NoLastRowIdConn()

    @contextlib.contextmanager
    def fake_connection() -> Generator[NoLastRowIdConn, None, None]:
        yield fake_conn

    monkeypatch.setattr(database, "connection", fake_connection)

    with pytest.raises(ValueError, match="Failed to get lastrowid"):
        database.set_item({"src": "x"})


def test_delete_items_by_file_path_with_conn_uses_json_extract_delete(
    database: LGDatabase,
) -> None:
    database.set_item({"src": "a1", "file_path": "a.txt"})
    database.set_item({"src": "b1", "file_path": "b.txt"})

    with database.connection() as conn:
        deleted = database.delete_items_by_file_path("a.txt", conn=conn)
        conn.commit()

    assert deleted == 1
    assert database.get_all_items() == [{"id": 2, "src": "b1", "file_path": "b.txt"}]


def test_delete_items_by_file_path_with_conn_reraises_non_json_extract_error() -> None:
    db = LGDatabase(":memory:")
    fake_conn = JsonExtractErrorConn("database is locked")

    with pytest.raises(sqlite3.OperationalError, match="database is locked"):
        db.delete_items_by_file_path("a.txt", conn=cast(sqlite3.Connection, fake_conn))


def test_delete_items_by_file_path_without_conn_reraises_non_json_extract_error(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_conn = JsonExtractErrorConn("database is locked")

    @contextlib.contextmanager
    def fake_connection() -> Generator[JsonExtractErrorConn, None, None]:
        yield fake_conn

    monkeypatch.setattr(database, "connection", fake_connection)

    with pytest.raises(sqlite3.OperationalError, match="database is locked"):
        database.delete_items_by_file_path("a.txt")


def test_update_batch_returns_early_when_no_data(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = False

    @contextlib.contextmanager
    def fake_connection() -> Generator[sqlite3.Connection, None, None]:
        nonlocal called
        called = True
        assert database.keep_alive_conn is not None
        yield database.keep_alive_conn

    monkeypatch.setattr(database, "connection", fake_connection)

    database.update_batch()

    assert called is False


def test_update_batch_handles_items_without_id_rules_only_and_no_meta(
    database: LGDatabase,
) -> None:
    database.update_batch(
        items=[{"src": "no-id"}],
        rules={
            LGDatabase.RuleType.POST_REPLACEMENT: [
                {"src": "A", "dst": "B", "info": "", "regex": False}
            ]
        },
    )

    assert database.get_rules(LGDatabase.RuleType.POST_REPLACEMENT) == [
        {"src": "A", "dst": "B", "info": "", "regex": False}
    ]


def test_update_batch_skips_rules_when_only_items_and_meta_are_provided(
    database: LGDatabase,
) -> None:
    item_id = database.set_item({"src": "before", "dst": "old"})

    database.update_batch(
        items=[{"id": item_id, "src": "after", "dst": "new"}],
        meta={"k": "v"},
    )

    assert database.get_all_items() == [{"id": item_id, "src": "after", "dst": "new"}]
    assert database.get_meta("k") == "v"


def test_update_batch_supports_rules_only(database: LGDatabase) -> None:
    database.update_batch(
        rules={
            LGDatabase.RuleType.TEXT_PRESERVE: [
                {"src": "A", "dst": "B", "info": "", "regex": False}
            ]
        }
    )

    assert database.get_rules(LGDatabase.RuleType.TEXT_PRESERVE) == [
        {"src": "A", "dst": "B", "info": "", "regex": False}
    ]


def test_get_rules_returns_empty_when_no_rows(database: LGDatabase) -> None:
    assert database.get_rules(LGDatabase.RuleType.TEXT_PRESERVE) == []


def test_get_rules_handles_list_row_and_multiple_decode_errors(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    logger = MagicMock()
    monkeypatch.setattr("module.Data.Storage.LGDatabase.LogManager.get", lambda: logger)

    with database.connection() as conn:
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, '{"src":"A","dst":"甲"}'),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, '[{"src":"B","dst":"乙"}]'),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, "123"),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, '{"src":"C","dst":"丙"}'),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, "bad-json-1"),
        )
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.PRE_REPLACEMENT, "bad-json-2"),
        )
        conn.commit()

    assert database.get_rules(LGDatabase.RuleType.PRE_REPLACEMENT) == [
        {"src": "A", "dst": "甲"},
        {"src": "B", "dst": "乙"},
        {"src": "C", "dst": "丙"},
    ]
    logger.warning.assert_called_once()


def test_set_rules_overwrites_existing_rows(database: LGDatabase) -> None:
    with database.connection() as conn:
        conn.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (LGDatabase.RuleType.GLOSSARY, '{"src":"old","dst":"旧"}'),
        )
        conn.commit()

    database.set_rules(
        LGDatabase.RuleType.GLOSSARY,
        [{"src": "new", "dst": "新", "info": "", "regex": False}],
    )

    assert database.get_rules(LGDatabase.RuleType.GLOSSARY) == [
        {"src": "new", "dst": "新", "info": "", "regex": False}
    ]
