from collections.abc import Generator

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


def test_add_asset_and_get_asset_roundtrip(database: LGDatabase) -> None:
    asset_id = database.add_asset("a.bin", b"raw-data", original_size=8)

    assert isinstance(asset_id, int)
    assert database.get_asset("a.bin") == b"raw-data"
    assert database.get_asset("missing.bin") is None


def test_connection_reuses_keep_alive_connection(database: LGDatabase) -> None:
    database.open()
    try:
        with database.connection() as first:
            with database.connection() as second:
                assert first is second
    finally:
        database.close()


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


def test_delete_asset_removes_record(database: LGDatabase) -> None:
    database.add_asset("a.bin", b"v1", original_size=2)
    assert database.get_asset("a.bin") == b"v1"

    database.delete_asset("a.bin")

    assert database.get_asset("a.bin") is None


def test_update_asset_replaces_data(database: LGDatabase) -> None:
    database.add_asset("a.bin", b"v1", original_size=2)

    database.update_asset("a.bin", b"v2", original_size=2)

    assert database.get_asset("a.bin") == b"v2"


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
