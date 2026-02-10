from __future__ import annotations

import pytest

from model.Item import Item
from module.Config import Config
from module.File.RenPy.RenPy import RenPy
from module.File.RenPy.RenPyExtractor import RenPyExtractor
from module.File.RenPy.RenPyLexer import sha1_hex


def make_ast_item(
    *,
    lang: str,
    label: str,
    digest: str,
    target_line: int,
    src: str,
    dst: str,
    name_src: str | None = None,
    name_dst: str | None = None,
) -> Item:
    return Item.from_dict(
        {
            "src": src,
            "dst": dst,
            "name_src": name_src,
            "name_dst": name_dst,
            "extra_field": {
                "renpy": {
                    "block": {"lang": lang, "label": label},
                    "pair": {"target_line": target_line},
                    "digest": {
                        "template_raw_sha1": digest,
                        "template_raw_rstrip_sha1": digest,
                    },
                }
            },
        }
    )


def test_transfer_ast_translations_transfers_dst_and_name(config: Config) -> None:
    handler = RenPy(config)
    digest = "abc"
    existing = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest=digest,
            target_line=10,
            src="hello",
            dst="你好",
            name_src="Alice",
            name_dst="艾丽丝",
        )
    ]
    new_items = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest=digest,
            target_line=99,
            src="hello",
            dst="",
            name_src="Alice",
            name_dst=None,
        )
    ]

    written_lines = handler.transfer_ast_translations(existing, new_items)

    assert new_items[0].get_dst() == "你好"
    assert new_items[0].get_name_dst() == "艾丽丝"
    assert written_lines == {99}


def test_transfer_legacy_translations_respects_skip_target_lines(
    config: Config,
) -> None:
    handler = RenPy(config)
    legacy_raw = '    # e "Hello"'
    legacy_items = [
        Item.from_dict(
            {
                "row": 1,
                "src": "",
                "dst": "",
                "extra_field": "translate chinese start:",
            }
        ),
        Item.from_dict(
            {
                "row": 2,
                "src": "Hello",
                "dst": "你好",
                "name_dst": "艾丽丝",
                "extra_field": legacy_raw,
            }
        ),
    ]
    new_item = make_ast_item(
        lang="chinese",
        label="start",
        digest=sha1_hex(legacy_raw),
        target_line=15,
        src="Hello",
        dst="",
        name_src="Alice",
        name_dst=None,
    )

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines={15}
    )
    assert new_item.get_dst() == ""

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines=None
    )
    assert new_item.get_dst() == "你好"
    assert new_item.get_name_dst() == "艾丽丝"


def test_build_items_for_writeback_returns_items_directly_when_all_ast(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = RenPy(config)
    items = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest="abc",
            target_line=1,
            src="x",
            dst="y",
        )
    ]

    monkeypatch.setattr(
        "module.File.RenPy.RenPy.parse_document",
        lambda lines: (_ for _ in ()).throw(AssertionError("should not be called")),
    )

    result = handler.build_items_for_writeback(
        extractor=RenPyExtractor(),
        rel_path="a.rpy",
        lines=["translate chinese start:"],
        items=items,
    )

    assert result is items
