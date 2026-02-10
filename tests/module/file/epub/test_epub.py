from __future__ import annotations

import sys
from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.EPUB.EPUB import EPUB
from tests.module.file.conftest import DummyDataManager


def make_epub_item(rel_path: str, extra_field: dict | str | None = None) -> Item:
    return Item.from_dict(
        {
            "src": "s",
            "dst": "d",
            "row": 1,
            "file_type": Item.FileType.EPUB,
            "file_path": rel_path,
            "extra_field": {} if extra_field is None else extra_field,
        }
    )


def test_has_epub_ast_metadata(config: Config) -> None:
    handler = EPUB(config)

    assert handler.has_epub_ast_metadata(make_epub_item("a.epub", "invalid")) is False
    assert (
        handler.has_epub_ast_metadata(
            make_epub_item("a.epub", {"epub": {"parts": [{"slot": "text"}]}})
        )
        is True
    )


def test_build_epub_from_items_uses_ast_writer_when_all_have_metadata(
    config: Config,
) -> None:
    handler = EPUB(config)
    called = {"ast": 0, "legacy": 0}

    class AstWriter:
        def build_epub(self, **kwargs) -> None:
            del kwargs
            called["ast"] += 1

    class LegacyWriter:
        def build_epub(self, **kwargs) -> None:
            del kwargs
            called["legacy"] += 1

    handler.writer = AstWriter()
    handler.legacy_writer = LegacyWriter()
    items = [make_epub_item("book.epub", {"epub": {"parts": [{"slot": "text"}]}})]

    handler.build_epub_from_items(b"epub", items, "out.epub", bilingual=False)

    assert called == {"ast": 1, "legacy": 0}


def test_build_epub_from_items_falls_back_to_legacy_writer(config: Config) -> None:
    handler = EPUB(config)
    called = {"ast": 0, "legacy": 0}

    class AstWriter:
        def build_epub(self, **kwargs) -> None:
            del kwargs
            called["ast"] += 1

    class LegacyWriter:
        def build_epub(self, **kwargs) -> None:
            del kwargs
            called["legacy"] += 1

    handler.writer = AstWriter()
    handler.legacy_writer = LegacyWriter()
    items = [make_epub_item("book.epub", {"renpy": {"parts": []}})]

    handler.build_epub_from_items(b"epub", items, "out.epub", bilingual=True)

    assert called == {"ast": 0, "legacy": 1}


def test_write_to_path_builds_translated_and_bilingual_outputs(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    epub_module = sys.modules[EPUB.__module__]
    monkeypatch.setattr(epub_module.DataManager, "get", lambda: dummy_data_manager)
    calls: list[tuple[str, bool]] = []
    handler = EPUB(config)

    def fake_build(
        original_epub_bytes: bytes, items: list[Item], out_path: str, bilingual: bool
    ) -> None:
        del original_epub_bytes
        del items
        calls.append((out_path, bilingual))

    handler.build_epub_from_items = fake_build
    dummy_data_manager.assets["novel/book.epub"] = b"raw"
    items = [
        make_epub_item("novel/book.epub", {"epub": {"parts": [{"slot": "text"}]}}),
        Item.from_dict({"file_type": Item.FileType.TXT, "file_path": "novel/a.txt"}),
    ]

    handler.write_to_path(items)

    translated = (
        Path(dummy_data_manager.get_translated_path()) / "novel" / "book.zh.epub"
    )
    bilingual = (
        Path(dummy_data_manager.get_bilingual_path()) / "novel" / "book.ja.zh.epub"
    )
    assert len(calls) == 2
    assert Path(calls[0][0]) == translated
    assert calls[0][1] is False
    assert Path(calls[1][0]) == bilingual
    assert calls[1][1] is True


def test_insert_target_and_insert_source_target(config: Config) -> None:
    handler = EPUB(config)

    assert handler.insert_target("out/book.epub") == "out/book.zh.epub"
    assert handler.insert_source_target("out/book.epub") == "out/book.ja.zh.epub"
