from __future__ import annotations

import json
from pathlib import Path

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.File.KVJSON import KVJSON
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_sets_status_by_src_dst(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.KVJSON.TextHelper.get_encoding", lambda **_: "utf-8"
    )
    payload = {"": "", "已翻": "已处理", "待翻": "待翻", "忽略": 1}

    items = KVJSON(config).read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        "a.json",
    )

    assert len(items) == 3
    assert items[0].get_status() == Base.ProjectStatus.EXCLUDED
    assert items[1].get_status() == Base.ProjectStatus.PROCESSED_IN_PAST
    assert items[2].get_status() == Base.ProjectStatus.NONE


def test_read_from_stream_returns_empty_when_json_is_not_dict(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.KVJSON.TextHelper.get_encoding", lambda **_: "utf-8"
    )
    monkeypatch.setattr("module.File.KVJSON.JSONTool.loads", lambda _: ["not", "dict"])

    assert KVJSON(config).read_from_stream(b"[]", "a.json") == []


def test_read_from_stream_decodes_non_utf8_payload(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.KVJSON.TextHelper.get_encoding", lambda **_: "latin-1"
    )
    received: list[object] = []

    def fake_loads(payload: object):
        received.append(payload)
        return {"k": "v"}

    monkeypatch.setattr("module.File.KVJSON.JSONTool.loads", fake_loads)

    items = KVJSON(config).read_from_stream(b'{"k":"v"}', "a.json")

    assert received and isinstance(received[0], str)
    assert [item.get_src() for item in items] == ["k"]


def test_write_to_path_writes_json_mapping(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.KVJSON.DataManager.get", lambda: dummy_data_manager
    )
    items = [
        Item.from_dict(
            {
                "src": "k1",
                "dst": "v1",
                "row": 0,
                "file_type": Item.FileType.KVJSON,
                "file_path": "json/data.json",
            }
        ),
        Item.from_dict(
            {
                "src": "k2",
                "dst": "v2",
                "row": 1,
                "file_type": Item.FileType.KVJSON,
                "file_path": "json/data.json",
            }
        ),
    ]

    KVJSON(config).write_to_path(items)

    output_file = Path(dummy_data_manager.get_translated_path()) / "json" / "data.json"
    assert json.loads(output_file.read_text(encoding="utf-8")) == {
        "k1": "v1",
        "k2": "v2",
    }


def test_read_from_path_reads_files(
    fs,
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "module.File.KVJSON.TextHelper.get_encoding", lambda **_: "utf-8"
    )
    fs.create_file(
        "/fake/input/a.json",
        contents='{"k":"v"}',
        create_missing_dirs=True,
    )

    items = KVJSON(config).read_from_path(["/fake/input/a.json"], "/fake/input")

    assert len(items) == 1
    assert items[0].get_file_path() == "a.json"
