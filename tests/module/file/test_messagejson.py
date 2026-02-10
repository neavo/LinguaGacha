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
