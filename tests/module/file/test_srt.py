from __future__ import annotations

from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.SRT import SRT
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_parses_standard_blocks(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.SRT.TextHelper.get_encoding", lambda **_: "utf-8")
    content = (
        "1\n00:00:01,000 --> 00:00:02,000\n第一句\n\n"
        "x\n00:00:03,000 --> 00:00:04,000\n应被跳过\n\n"
        "2\n00:00:05,000 --> 00:00:06,000\n第二句\n第二行"
    ).encode("utf-8")

    items = SRT(config).read_from_stream(content, "sub.srt")

    assert len(items) == 2
    assert items[0].get_row() == 1
    assert items[0].get_extra_field() == "00:00:01,000 --> 00:00:02,000"
    assert items[0].get_src() == "第一句"
    assert items[1].get_row() == 2
    assert items[1].get_src() == "第二句\n第二行"


def test_read_from_stream_ignores_leading_and_extra_blank_lines(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.SRT.TextHelper.get_encoding", lambda **_: "utf-8")
    content = (
        "\n\n"
        "1\n00:00:01,000 --> 00:00:02,000\n第一句\n\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\n第二句\n\n"
    ).encode("utf-8")

    items = SRT(config).read_from_stream(content, "sub.srt")

    assert [i.get_row() for i in items] == [1, 2]


def test_read_from_path_reads_files(
    fs,
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.SRT.TextHelper.get_encoding", lambda **_: "utf-8")
    fs.create_file(
        "/fake/input/a.srt",
        contents=(
            "1\n00:00:01,000 --> 00:00:02,000\n第一句\n\n"
            "2\n00:00:03,000 --> 00:00:04,000\n第二句\n\n"
        ),
        create_missing_dirs=True,
    )

    items = SRT(config).read_from_path(["/fake/input/a.srt"], "/fake/input")

    assert len(items) == 2
    assert {item.get_file_path() for item in items} == {"a.srt"}


def test_write_to_path_writes_translated_and_bilingual_files(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.SRT.DataManager.get", lambda: dummy_data_manager)
    items = [
        Item.from_dict(
            {
                "src": "同文",
                "dst": "同文",
                "row": 1,
                "extra_field": "00:00:01,000 --> 00:00:02,000",
                "file_type": Item.FileType.SRT,
                "file_path": "video/a.srt",
            }
        ),
        Item.from_dict(
            {
                "src": "原文",
                "dst": "译文",
                "row": 2,
                "extra_field": "00:00:03,000 --> 00:00:04,000",
                "file_type": Item.FileType.SRT,
                "file_path": "video/a.srt",
            }
        ),
    ]

    SRT(config).write_to_path(items)

    translated_file = (
        Path(dummy_data_manager.get_translated_path()) / "video" / "a.zh.srt"
    )
    bilingual_file = (
        Path(dummy_data_manager.get_bilingual_path()) / "video" / "a.ja.zh.srt"
    )
    assert translated_file.read_text(encoding="utf-8") == (
        "1\n00:00:01,000 --> 00:00:02,000\n同文\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\n译文\n\n"
    )
    assert bilingual_file.read_text(encoding="utf-8") == (
        "1\n00:00:01,000 --> 00:00:02,000\n同文\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\n原文\n译文\n\n"
    )


def test_write_to_path_noop_when_no_srt_items(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.SRT.DataManager.get", lambda: dummy_data_manager)
    SRT(config).write_to_path([])

    translated_root = Path(dummy_data_manager.get_translated_path())
    bilingual_root = Path(dummy_data_manager.get_bilingual_path())
    assert list(translated_root.rglob("*.srt")) == []
    assert list(bilingual_root.rglob("*.srt")) == []
