from __future__ import annotations

from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.TXT import TXT
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_splits_lines(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.TXT.TextHelper.get_encoding", lambda **_: "utf-8")

    items = TXT(config).read_from_stream(
        "第一行\r\n第二行\n第三行".encode("utf-8"), "a.txt"
    )

    assert [item.get_src() for item in items] == ["第一行", "第二行", "第三行"]
    assert all(item.get_file_type() == Item.FileType.TXT for item in items)


def test_write_to_path_writes_translated_and_bilingual_files(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.TXT.DataManager.get", lambda: dummy_data_manager)
    items = [
        Item.from_dict(
            {
                "src": "同文",
                "dst": "同文",
                "row": 0,
                "file_type": Item.FileType.TXT,
                "file_path": "story/dialog.txt",
            }
        ),
        Item.from_dict(
            {
                "src": "原文",
                "dst": "译文",
                "row": 1,
                "file_type": Item.FileType.TXT,
                "file_path": "story/dialog.txt",
            }
        ),
    ]

    TXT(config).write_to_path(items)

    translated_file = (
        Path(dummy_data_manager.get_translated_path()) / "story" / "dialog.zh.txt"
    )
    bilingual_file = (
        Path(dummy_data_manager.get_bilingual_path()) / "story" / "dialog.ja.zh.txt"
    )
    assert translated_file.read_text(encoding="utf-8") == "同文\n译文"
    assert bilingual_file.read_text(encoding="utf-8") == "同文\n原文\n译文"
