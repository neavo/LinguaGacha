from collections.abc import Generator
import contextlib
from pathlib import Path
import sqlite3
from typing import cast
from unittest.mock import MagicMock

import pytest

from module.Data.LGDatabase import LGDatabase


@pytest.fixture
def database() -> Generator[LGDatabase, None, None]:
    db = LGDatabase(":memory:")
    db.open()
    try:
        yield db
    finally:
        db.close()


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

    assert db.is_open() is False


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
    monkeypatch.setattr("module.Data.LGDatabase.LogManager.get", lambda: logger)

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


def test_create_creates_persistent_db_file_and_sets_base_meta(tmp_path: Path) -> None:
    db_path = tmp_path / "demo.lg"
    db = LGDatabase.create(str(db_path), "Demo")

    assert db.is_open() is False
    assert db.get_meta("name") == "Demo"
    assert db.get_meta("schema_version") == LGDatabase.SCHEMA_VERSION
    assert isinstance(db.get_meta("created_at"), str)
    assert isinstance(db.get_meta("updated_at"), str)


def test_add_asset_and_get_asset_roundtrip(database: LGDatabase) -> None:
    asset_id = database.add_asset("a.bin", b"raw-data", original_size=8)

    assert isinstance(asset_id, int)
    assert database.get_asset("a.bin") == b"raw-data"
    assert database.get_asset("missing.bin") is None


def test_get_all_asset_paths_and_count_preserve_insert_order(
    database: LGDatabase,
) -> None:
    database.add_asset("a.txt", b"1", 1)
    database.add_asset("b.txt", b"2", 1)

    assert database.get_all_asset_paths() == ["a.txt", "b.txt"]
    assert database.get_asset_count() == 2

    # 更新路径不应改变展示顺序（按 id 排序）。
    database.update_asset_path("a.txt", "c.txt")
    assert database.get_all_asset_paths() == ["c.txt", "b.txt"]


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


def test_short_connection_context_creates_schema_and_closes(tmp_path: Path) -> None:
    db_path = tmp_path / "short_conn.lg"
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


def test_get_and_set_rule_text_roundtrip(database: LGDatabase) -> None:
    assert database.get_rule_text(LGDatabase.RuleType.CUSTOM_PROMPT_ZH) == ""

    database.set_rule_text(LGDatabase.RuleType.CUSTOM_PROMPT_ZH, "prompt")

    assert database.get_rule_text(LGDatabase.RuleType.CUSTOM_PROMPT_ZH) == "prompt"


def test_get_items_by_file_path_filters_by_json_extract(database: LGDatabase) -> None:
    id_a1 = database.set_item({"src": "a1", "file_path": "a.txt"})
    database.set_item({"src": "b1", "file_path": "b.txt"})
    id_a2 = database.set_item({"src": "a2", "file_path": "a.txt"})

    items = database.get_items_by_file_path("a.txt")

    assert [item["id"] for item in items] == [id_a1, id_a2]
    assert [item["src"] for item in items] == ["a1", "a2"]


class FakeConn:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def execute(self, sql: str, params: tuple = ()):
        if "json_extract" in sql:
            raise sqlite3.OperationalError("no such function: json_extract")
        return self.conn.execute(sql, params)

    def commit(self) -> None:
        self.conn.commit()


def test_get_items_by_file_path_falls_back_when_json_extract_missing(
    database: LGDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    id_a1 = database.set_item({"src": "a1", "file_path": "a.txt"})
    database.set_item({"src": "b1", "file_path": "b.txt"})
    id_a2 = database.set_item({"src": "a2", "file_path": "a.txt"})
    assert database.keep_alive_conn is not None

    fake = FakeConn(database.keep_alive_conn)

    @contextlib.contextmanager
    def fake_connection():
        yield fake

    monkeypatch.setattr(database, "connection", fake_connection)

    items = database.get_items_by_file_path("a.txt")
    assert [item["id"] for item in items] == [id_a1, id_a2]


def test_delete_items_by_file_path_removes_matching_items(database: LGDatabase) -> None:
    database.set_item({"src": "a1", "file_path": "a.txt"})
    id_b1 = database.set_item({"src": "b1", "file_path": "b.txt"})
    database.set_item({"src": "a2", "file_path": "a.txt"})

    deleted = database.delete_items_by_file_path("a.txt")

    assert deleted == 2
    assert database.get_all_items() == [
        {"id": id_b1, "src": "b1", "file_path": "b.txt"}
    ]
    assert database.get_items_by_file_path("a.txt") == []
    assert database.get_items_by_file_path("b.txt") == [
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


def test_update_asset_path_update_asset_delete_asset_and_insert_items_support_conn_param(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "conn_param.lg"
    db = LGDatabase(str(db_path))
    db.add_asset("a.bin", b"v1", 2)

    with db.connection() as conn:
        db.update_asset("a.bin", b"v2", 2, conn=conn)
        conn.commit()
        assert db.get_asset("a.bin") == b"v2"

        assert db.update_asset_path("a.bin", "b.bin", conn=conn) == 1
        conn.commit()
        assert db.get_asset("b.bin") == b"v2"

        ids = db.insert_items([{"src": "A"}, {"src": "B"}], conn=conn)
        conn.commit()
        assert ids and all(isinstance(v, int) for v in ids)

        db.delete_asset("b.bin", conn=conn)
        conn.commit()
        assert db.get_asset("b.bin") is None


def test_insert_items_appends_without_clearing(database: LGDatabase) -> None:
    id_old = database.set_item({"src": "old", "file_path": "old.txt"})

    ids_new = database.insert_items(
        [
            {"src": "n1", "file_path": "new.txt"},
            {"src": "n2", "file_path": "new.txt"},
        ]
    )

    assert len(ids_new) == 2
    items = database.get_all_items()
    assert [item["id"] for item in items] == [id_old, *ids_new]
    assert [item["src"] for item in items] == ["old", "n1", "n2"]


def test_asset_path_exists_returns_correct_bool(database: LGDatabase) -> None:
    assert database.asset_path_exists("a.bin") is False

    database.add_asset("a.bin", b"raw", original_size=3)

    assert database.asset_path_exists("a.bin") is True
