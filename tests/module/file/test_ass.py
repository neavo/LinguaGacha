from __future__ import annotations

from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.ASS import ASS
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_extracts_dialogue_content(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.ASS.TextHelper.get_encoding", lambda **_: "utf-8")
    content = (
        "[Script Info]\n"
        "Title: Test\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,第一行\\N第二行\n"
    ).encode("utf-8")

    items = ASS(config).read_from_stream(content, "sub.ass")

    assert items[-1].get_src() == "第一行\n第二行"
    assert items[-1].get_dst() == "第一行\n第二行"
    assert items[-1].get_extra_field() == (
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{{CONTENT}}"
    )


def test_read_from_stream_works_without_format_line(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.ASS.TextHelper.get_encoding", lambda **_: "utf-8")
    content = (
        "[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Text\n"
    ).encode("utf-8")

    items = ASS(config).read_from_stream(content, "sub.ass")

    assert items[-1].get_src() == "Text"
    assert "{{CONTENT}}" in str(items[-1].get_extra_field())


def test_read_from_path_reads_files(
    fs,
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.ASS.TextHelper.get_encoding", lambda **_: "utf-8")
    fs.create_file(
        "/fake/input/sub.ass",
        contents=(
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,第一行\\N第二行\n"
        ),
        create_missing_dirs=True,
    )

    items = ASS(config).read_from_path(["/fake/input/sub.ass"], "/fake/input")

    assert items[-1].get_file_path() == "sub.ass"


def test_write_to_path_writes_ass_outputs(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.deduplication_in_bilingual = False
    monkeypatch.setattr("module.File.ASS.DataManager.get", lambda: dummy_data_manager)
    items = [
        Item.from_dict(
            {
                "src": "原文1",
                "dst": "译文1",
                "row": 0,
                "extra_field": "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{{CONTENT}}",
                "file_type": Item.FileType.ASS,
                "file_path": "anime/sub.ass",
            }
        ),
        Item.from_dict(
            {
                "src": "原文2",
                "dst": "译文2",
                "row": 1,
                "extra_field": "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{{CONTENT}}",
                "file_type": Item.FileType.ASS,
                "file_path": "anime/sub.ass",
            }
        ),
    ]

    ASS(config).write_to_path(items)

    translated_file = (
        Path(dummy_data_manager.get_translated_path()) / "anime" / "sub.zh.ass"
    )
    bilingual_file = (
        Path(dummy_data_manager.get_bilingual_path()) / "anime" / "sub.ja.zh.ass"
    )
    assert translated_file.read_text(encoding="utf-8") == (
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,译文1\n"
        "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,译文2"
    )
    assert bilingual_file.read_text(encoding="utf-8") == (
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,原文1\\N译文1\n"
        "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,原文2\\N译文2"
    )


def test_write_to_path_bilingual_deduplicates_when_src_equals_dst(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.deduplication_in_bilingual = True
    monkeypatch.setattr("module.File.ASS.DataManager.get", lambda: dummy_data_manager)
    items = [
        Item.from_dict(
            {
                "src": "同文",
                "dst": "同文",
                "row": 0,
                "extra_field": "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{{CONTENT}}",
                "file_type": Item.FileType.ASS,
                "file_path": "anime/sub.ass",
            }
        )
    ]

    ASS(config).write_to_path(items)

    bilingual_file = (
        Path(dummy_data_manager.get_bilingual_path()) / "anime" / "sub.ja.zh.ass"
    )
    content = bilingual_file.read_text(encoding="utf-8")
    assert content == "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,同文"
    assert "{{CONTENT}}" not in content
