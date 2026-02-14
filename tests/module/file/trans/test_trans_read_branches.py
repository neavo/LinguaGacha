from __future__ import annotations

import json
from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.TRANS.TRANS import TRANS
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_returns_empty_for_invalid_shapes(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)

    monkeypatch.setattr("module.File.TRANS.TRANS.JSONTool.loads", lambda content: [])
    assert handler.read_from_stream(b"[]", "a.trans") == []

    monkeypatch.setattr(
        "module.File.TRANS.TRANS.JSONTool.loads",
        lambda content: {"project": {"files": []}},
    )
    assert handler.read_from_stream(b"{}", "a.trans") == []


def test_read_from_path_reads_files_and_builds_rel_path(
    config: Config,
    fs,
) -> None:
    del fs
    handler = TRANS(config)
    input_root = Path("/workspace/trans")
    file_a = input_root / "a.trans"
    file_b = input_root / "sub" / "b.trans"
    file_b.parent.mkdir(parents=True, exist_ok=True)
    file_a.write_text("a", encoding="utf-8")
    file_b.write_text("b", encoding="utf-8")

    def fake_read_from_stream(content: bytes, rel_path: str) -> list[Item]:
        del content
        return [Item.from_dict({"src": rel_path})]

    handler.read_from_stream = fake_read_from_stream
    items = handler.read_from_path([str(file_a), str(file_b)], str(input_root))

    rels = sorted(item.get_src().replace("\\", "/") for item in items)
    assert rels == ["a.trans", "sub/b.trans"]


def test_read_from_stream_clamps_negative_column_indices(config: Config) -> None:
    handler = TRANS(config)

    # indexOriginal/indexTranslation 出现负数时，不应触发 Python 负索引取值。
    payload = {
        "project": {
            "gameEngine": "dummy",
            "indexOriginal": -1,
            "indexTranslation": -2,
            "files": {
                "script/a.json": {
                    "tags": [[]],
                    "data": [["SRC", "DST"]],
                    "context": [[]],
                    "parameters": [[]],
                }
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        "negative.trans",
    )

    assert len(items) == 1
    assert items[0].get_src() == "SRC"
    assert items[0].get_dst() == "DST"


def test_read_from_stream_filters_metadata_and_builds_trans_ref(
    config: Config,
) -> None:
    handler = TRANS(config)
    rel_path = "meta.trans"
    file_key = "script/meta.json"

    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [["keep", 1, None]],
                    "data": [["src", ""]],
                    "context": [["ctx1", None, 2]],
                    "parameters": [[{"ok": True}, None, "bad"]],
                }
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        rel_path,
    )

    assert len(items) == 1
    item = items[0]
    extra = item.get_extra_field()

    assert item.get_tag() == file_key
    assert item.get_file_path() == rel_path
    assert isinstance(extra, dict)
    assert extra["tag"] == ["keep"]
    assert extra["context"] == ["ctx1"]
    assert extra["parameter"] == [{"ok": True}]
    assert extra["trans_ref"] == {"file_key": file_key, "row_index": 0}


def test_read_from_stream_skips_non_dict_file_entries(config: Config) -> None:
    handler = TRANS(config)
    rel_path = "skip_entries.trans"
    file_key = "script/good.json"

    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                "bad_entry": [],
                file_key: {
                    "tags": [[]],
                    "data": [["src", "dst"]],
                    "context": [[]],
                    "parameters": [[]],
                },
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        rel_path,
    )

    assert len(items) == 1
    assert items[0].get_tag() == file_key
    assert items[0].get_src() == "src"
    assert items[0].get_dst() == "dst"


def test_write_to_path_skips_when_asset_missing_or_invalid_json(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "sample.trans"
    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "tag": "script/a.json",
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )

    handler.write_to_path([item])
    assert (dummy_data_manager.translated_path / rel_path).exists() is False

    dummy_data_manager.assets[rel_path] = json.dumps(["not", "dict"]).encode("utf-8")
    handler.write_to_path([item])
    assert (dummy_data_manager.translated_path / rel_path).exists() is False


@pytest.mark.parametrize(
    ("rel_path", "payload"),
    [
        ("invalid_project.trans", {"project": []}),
        ("invalid_files.trans", {"project": {"files": []}}),
    ],
)
def test_write_to_path_skips_when_project_or_files_shape_invalid(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
    rel_path: str,
    payload: dict,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "tag": "script/a.json",
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    handler.write_to_path([item])
    assert (dummy_data_manager.translated_path / rel_path).exists() is False
