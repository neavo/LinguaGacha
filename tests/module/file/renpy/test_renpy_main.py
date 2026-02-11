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


def test_build_ast_keys_returns_empty_for_invalid_extra_field(config: Config) -> None:
    handler = RenPy(config)

    assert handler.build_ast_keys(Item.from_dict({"extra_field": "legacy"})) == []
    assert handler.build_ast_keys(Item.from_dict({"extra_field": {"renpy": "x"}})) == []
    assert (
        handler.build_ast_keys(
            Item.from_dict({"extra_field": {"renpy": {"block": None}}})
        )
        == []
    )


def test_build_ast_keys_deduplicates_fallback_when_same_as_primary(
    config: Config,
) -> None:
    handler = RenPy(config)
    item = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "a",
                    },
                }
            }
        }
    )

    assert handler.build_ast_keys(item) == [("chinese", "start", "a")]


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


def test_pick_best_candidate_falls_back_to_src_match(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict({"src": "Hello", "name_src": "Alice"})
    candidates = [
        Item.from_dict({"src": "Hello", "name_src": "Bob", "dst": "B"}),
        Item.from_dict({"src": "Other", "name_src": "Alice", "dst": "X"}),
    ]

    picked = handler.pick_best_candidate(item, candidates)

    assert picked.get_dst() == "B"
    assert len(candidates) == 1


def test_pick_best_candidate_falls_back_to_first_candidate_when_no_match(
    config: Config,
) -> None:
    handler = RenPy(config)
    item = Item.from_dict({"src": "Hello"})
    candidates = [
        Item.from_dict({"src": "Other", "dst": "X"}),
        Item.from_dict({"src": "Another", "dst": "Y"}),
    ]

    picked = handler.pick_best_candidate(item, candidates)

    assert picked.get_dst() == "X"
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


def test_uniform_name_handles_list_names_and_skips_invalid(config: Config) -> None:
    handler = RenPy(config)
    items = [
        Item.from_dict({"name_src": ["hero", "villain"], "name_dst": ["勇者", "反派"]}),
        Item.from_dict({"name_src": None, "name_dst": "x"}),
        Item.from_dict({"name_src": "hero", "name_dst": None}),
    ]

    handler.uniform_name(items)

    assert items[0].get_name_dst() == ["勇者", "反派"]
    assert items[1].get_name_dst() == "x"
    assert items[2].get_name_dst() == "勇者"
