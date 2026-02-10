from __future__ import annotations

from model.Item import Item
from module.Config import Config
from module.File.RenPy.RenPy import RenPy


def test_has_ast_extra_field_and_get_item_target_line(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "pair": {"target_line": 12},
                }
            }
        }
    )

    assert handler.has_ast_extra_field(item) is True
    assert handler.get_item_target_line(item) == 12
    assert handler.get_item_target_line(Item.from_dict({"extra_field": "legacy"})) == 0


def test_build_ast_keys_and_parse_translate_header(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "b",
                    },
                }
            }
        }
    )

    assert handler.build_ast_keys(item) == [
        ("chinese", "start", "a"),
        ("chinese", "start", "b"),
    ]
    assert handler.parse_translate_header("translate chinese start:") == (
        "chinese",
        "start",
    )
    assert handler.parse_translate_header("invalid") is None


def test_pick_best_candidate_prefers_src_and_name(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict({"src": "Hello", "name_src": "Alice"})
    candidates = [
        Item.from_dict({"src": "Hello", "name_src": "Bob", "dst": "B"}),
        Item.from_dict({"src": "Hello", "name_src": "Alice", "dst": "A"}),
    ]

    picked = handler.pick_best_candidate(item, candidates)

    assert picked.get_dst() == "A"
    assert len(candidates) == 1


def test_uniform_name_and_revert_name(config: Config) -> None:
    handler = RenPy(config)
    items = [
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
        Item.from_dict({"name_src": "hero", "name_dst": "英雄"}),
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
    ]

    handler.uniform_name(items)
    assert [item.get_name_dst() for item in items] == ["勇者", "勇者", "勇者"]

    handler.revert_name(items)
    assert [item.get_name_dst() for item in items] == ["hero", "hero", "hero"]
