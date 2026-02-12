from __future__ import annotations

import json
from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.MESSAGEJSON import MESSAGEJSON
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_extracts_name_and_message(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.TextHelper.get_encoding",
        lambda **_: "utf-8",
    )
    payload = [
        {"name": "Alice", "message": "msg1"},
        {"names": ["Bob", 123, "Carol"], "message": "msg2"},
        {"message": "msg3"},
        {"name": "skip"},
        "invalid",
    ]

    items = MESSAGEJSON(config).read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        "m.json",
    )

    assert len(items) == 3
    assert items[0].get_name_src() == "Alice"
    assert items[1].get_name_src() == ["Bob", "Carol"]
    assert items[2].get_name_src() is None

    # MESSAGEJSON 作为展示型格式：读取时不预填 dst。
    assert [item.get_src() for item in items] == ["msg1", "msg2", "msg3"]
    assert [item.get_dst() for item in items] == ["", "", ""]


def test_write_to_path_falls_back_to_src_when_dst_empty(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.DataManager.get", lambda: dummy_data_manager
    )
    items = [
        Item.from_dict(
            {
                "src": "s1",
                "dst": "",
                "row": 1,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        )
    ]

    MESSAGEJSON(config).write_to_path(items)

    output_file = Path(dummy_data_manager.get_translated_path()) / "message" / "a.json"
    result = json.loads(output_file.read_text(encoding="utf-8"))
    assert result == [{"message": "s1"}]


def test_read_from_stream_decodes_non_utf8_payload(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.TextHelper.get_encoding",
        lambda **_: "latin-1",
    )
    received: list[object] = []

    def fake_loads(payload: object):
        received.append(payload)
        return [{"message": "msg"}]

    monkeypatch.setattr("module.File.MESSAGEJSON.JSONTool.loads", fake_loads)
    items = MESSAGEJSON(config).read_from_stream(b"[]", "m.json")

    assert received and isinstance(received[0], str)
    assert len(items) == 1


def test_read_from_stream_returns_empty_when_json_is_not_list(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.TextHelper.get_encoding",
        lambda **_: "utf-8",
    )
    monkeypatch.setattr("module.File.MESSAGEJSON.JSONTool.loads", lambda _: {"a": 1})

    assert MESSAGEJSON(config).read_from_stream(b"{}", "m.json") == []


def test_uniform_name_uses_most_frequent_translation(config: Config) -> None:
    handler = MESSAGEJSON(config)
    items = [
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
        Item.from_dict({"name_src": "hero", "name_dst": "英雄"}),
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
        Item.from_dict(
            {
                "name_src": ["hero", "villain"],
                "name_dst": ["未知", "反派"],
            }
        ),
    ]

    handler.uniform_name(items)

    assert items[1].get_name_dst() == "勇者"
    assert items[3].get_name_dst() == ["勇者", "反派"]


def test_uniform_name_skips_items_with_missing_name_fields(config: Config) -> None:
    handler = MESSAGEJSON(config)
    items = [
        Item.from_dict({"name_src": "hero", "name_dst": None}),
        Item.from_dict({"name_src": None, "name_dst": "x"}),
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
    ]

    handler.uniform_name(items)

    assert items[2].get_name_dst() == "勇者"


def test_write_to_path_reverts_name_when_config_disabled(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.write_translated_name_fields_to_file = False
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.DataManager.get", lambda: dummy_data_manager
    )
    items = [
        Item.from_dict(
            {
                "src": "old1",
                "dst": "new1",
                "name_src": "原名",
                "name_dst": "译名",
                "row": 2,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        ),
        Item.from_dict(
            {
                "src": "old0",
                "dst": "new0",
                "name_src": ["甲", "乙"],
                "name_dst": ["A", "B"],
                "row": 1,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        ),
    ]

    MESSAGEJSON(config).write_to_path(items)

    output_file = Path(dummy_data_manager.get_translated_path()) / "message" / "a.json"
    result = json.loads(output_file.read_text(encoding="utf-8"))
    assert result == [
        {"names": ["甲", "乙"], "message": "new0"},
        {"name": "原名", "message": "new1"},
    ]


def test_read_from_path_reads_files(
    fs,
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.TextHelper.get_encoding",
        lambda **_: "utf-8",
    )
    fs.create_file(
        "/fake/input/m.json",
        contents=json.dumps([{"message": "msg"}], ensure_ascii=False),
        create_missing_dirs=True,
    )

    items = MESSAGEJSON(config).read_from_path(["/fake/input/m.json"], "/fake/input")

    assert len(items) == 1
    assert items[0].get_file_path() == "m.json"


def test_write_to_path_uniform_name_and_writes_message_only_entry(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.write_translated_name_fields_to_file = True
    monkeypatch.setattr(
        "module.File.MESSAGEJSON.DataManager.get",
        lambda: dummy_data_manager,
    )
    items = [
        Item.from_dict(
            {
                "dst": "m1",
                "name_src": "hero",
                "name_dst": "勇者",
                "row": 1,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        ),
        Item.from_dict(
            {
                "dst": "m2",
                "name_src": "hero",
                "name_dst": "英雄",
                "row": 2,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        ),
        Item.from_dict(
            {
                "dst": "m2b",
                "name_src": "hero",
                "name_dst": "勇者",
                "row": 4,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        ),
        Item.from_dict(
            {
                "dst": "m3",
                "row": 3,
                "file_type": Item.FileType.MESSAGEJSON,
                "file_path": "message/a.json",
            }
        ),
    ]

    MESSAGEJSON(config).write_to_path(items)

    output_file = Path(dummy_data_manager.get_translated_path()) / "message" / "a.json"
    result = json.loads(output_file.read_text(encoding="utf-8"))
    hero_entries = [v for v in result if v.get("name") is not None]
    assert [v["name"] for v in hero_entries] == ["勇者", "勇者", "勇者"]
    assert {"message": "m3"} in result
