from __future__ import annotations

from pathlib import Path

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.File.MD import MD
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_marks_code_block_and_image_as_excluded(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.MD.TextHelper.get_encoding", lambda **_: "utf-8")
    content = "标题\n```python\nprint('hi')\n```\n![img](a.png)\n正文".encode("utf-8")

    items = MD(config).read_from_stream(content, "docs/readme.md")

    assert [item.get_src() for item in items] == [
        "标题",
        "```python",
        "print('hi')",
        "```",
        "![img](a.png)",
        "正文",
    ]
    assert items[0].get_status() == Base.ProjectStatus.NONE
    assert items[1].get_status() == Base.ProjectStatus.EXCLUDED
    assert items[2].get_status() == Base.ProjectStatus.EXCLUDED
    assert items[3].get_status() == Base.ProjectStatus.NONE
    assert items[4].get_status() == Base.ProjectStatus.EXCLUDED
    assert items[5].get_status() == Base.ProjectStatus.NONE


def test_insert_source_target(config: Config) -> None:
    handler = MD(config)

    assert handler.insert_source_target("docs/readme.md") == "docs/readme.ja.zh.md"


def test_write_to_path_writes_target_language_file(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.MD.DataManager.get", lambda: dummy_data_manager)
    items = [
        Item.from_dict(
            {
                "src": "a",
                "dst": "甲",
                "row": 0,
                "file_type": Item.FileType.MD,
                "file_path": "docs/readme.md",
            }
        ),
        Item.from_dict(
            {
                "src": "b",
                "dst": "乙",
                "row": 1,
                "file_type": Item.FileType.MD,
                "file_path": "docs/readme.md",
            }
        ),
        Item.from_dict(
            {
                "src": "ignore",
                "dst": "ignore",
                "row": 0,
                "file_type": Item.FileType.TXT,
                "file_path": "docs/other.txt",
            }
        ),
    ]

    MD(config).write_to_path(items)

    output_file = (
        Path(dummy_data_manager.get_translated_path()) / "docs" / "readme.zh.md"
    )
    assert output_file.exists()
    assert output_file.read_text(encoding="utf-8") == "甲\n乙"


def test_read_from_path_reads_files(
    fs,
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("module.File.MD.TextHelper.get_encoding", lambda **_: "utf-8")
    fs.create_file(
        "/fake/input/readme.md",
        contents="标题\n正文",
        create_missing_dirs=True,
    )

    items = MD(config).read_from_path(["/fake/input/readme.md"], "/fake/input")

    assert [item.get_src() for item in items] == ["标题", "正文"]
    assert {item.get_file_path() for item in items} == {"readme.md"}
