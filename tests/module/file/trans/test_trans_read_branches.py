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
