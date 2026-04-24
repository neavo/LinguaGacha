from __future__ import annotations

from module.Data.Core.Item import Item

from module.File.RenPy.RenPyLexer import build_skeleton

from module.File.RenPy.RenPyLexer import scan_double_quoted_literals

from module.File.RenPy.RenPyLexer import sha1_hex

from module.File.RenPy.RenPyWriter import RenPyWriter

from typing import Any

from typing import cast


def test_build_replacements_and_replace_literals() -> None:
    writer = RenPyWriter()
    item = Item.from_dict({"dst": "新台词", "name_dst": "新名字"})

    replacements = writer.build_replacements(
        item,
        [{"role": "NAME", "lit_index": 0}, {"role": "DIALOGUE", "lit_index": 1}],
    )
    code = 'e "old_name" "old_line"'
    replaced = writer.replace_literals_by_index(code, replacements)

    assert replacements == {0: "新名字", 1: "新台词"}
    assert replaced == 'e "新名字" "新台词"'


def test_apply_item_updates_target_line_for_label_kind() -> None:
    writer = RenPyWriter()
    lines = ['    # e "old"', '    e "old"']
    item = build_apply_item(
        lines,
        slots=[{"role": "DIALOGUE", "lit_index": 0}],
    )

    ok = writer.apply_item(lines, item)

    assert ok is True
    assert lines[1] == '    e "new"'


def test_apply_item_updates_only_dialogue_for_cb_name_suffix() -> None:
    writer = RenPyWriter()
    lines = [
        '    # "old text" (cb_name="mr")',
        '    "old text" (cb_name="mr")',
    ]
    item = build_apply_item(
        lines,
        src="old text",
        dst="new text",
        slots=[{"role": "DIALOGUE", "lit_index": 0}],
    )

    ok = writer.apply_item(lines, item)

    assert ok is True
    assert lines[1] == '    "new text" (cb_name="mr")'


def test_apply_item_preserves_trailing_function_argument_string() -> None:
    writer = RenPyWriter()
    lines = [
        '    # "Man" "old" with PushMove("x")',
        '    "Man" "old" with PushMove("x")',
    ]
    item = build_apply_item(
        lines,
        name_dst="",
        slots=[
            {"role": "NAME", "lit_index": 0},
            {"role": "DIALOGUE", "lit_index": 1},
        ],
    )

    ok = writer.apply_item(lines, item)

    assert ok is True
    assert lines[1] == '    "Man" "new" with PushMove("x")'


def test_apply_item_rejects_when_digest_mismatch() -> None:
    writer = RenPyWriter()
    lines = ['    # e "old"', '    e "old"']
    item = Item.from_dict(
        {
            "dst": "new",
            "extra_field": {
                "renpy": {
                    "pair": {"template_line": 1, "target_line": 2},
                    "digest": {
                        "template_raw_sha1": "bad",
                        "target_skeleton_sha1": "bad",
                        "target_string_count": 1,
                    },
                    "slots": [{"role": "DIALOGUE", "lit_index": 0}],
                    "block": {"kind": "LABEL"},
                }
            },
        }
    )

    assert writer.apply_item(lines, item) is False


def build_valid_case(kind: str = "LABEL") -> tuple[list[str], Item]:
    if kind == "STRINGS":
        lines = ['    old "old"', '    new "old"']
    else:
        lines = ['    # e "old"', '    e "old"']

    item = build_apply_item(
        lines,
        slots=[{"role": "DIALOGUE", "lit_index": 0}],
        kind=kind,
    )
    return lines, item


def build_apply_item(
    lines: list[str],
    slots: list[dict[str, object]],
    src: str = "old",
    dst: str = "new",
    name_dst: str = "新名字",
    kind: str = "LABEL",
) -> Item:
    target_rest = lines[1].lstrip()
    target_literals = scan_double_quoted_literals(target_rest)
    target_skeleton = build_skeleton(target_rest, target_literals)

    return Item.from_dict(
        {
            "src": src,
            "dst": dst,
            "name_dst": name_dst,
            "extra_field": {
                "renpy": {
                    "pair": {"template_line": 1, "target_line": 2},
                    "digest": {
                        "template_raw_sha1": sha1_hex(lines[0]),
                        "target_skeleton_sha1": sha1_hex(target_skeleton),
                        "target_string_count": len(target_literals),
                    },
                    "slots": slots,
                    "block": {"kind": kind},
                }
            },
        }
    )


def get_renpy_extra(item: Item) -> dict[str, Any]:
    extra_raw = item.get_extra_field()
    assert isinstance(extra_raw, dict)
    renpy_raw = extra_raw.get("renpy")
    assert isinstance(renpy_raw, dict)
    return cast(dict[str, Any], renpy_raw)


def test_apply_items_to_lines_counts_applied_and_skipped() -> None:
    writer = RenPyWriter()

    calls = [True, False, True]

    def fake_apply(lines: list[str], item: Item) -> bool:
        del lines
        del item
        return calls.pop(0)

    writer.apply_item = fake_apply
    items = [Item.from_dict({"src": "a"}) for _ in range(3)]
    applied, skipped = writer.apply_items_to_lines(["x"], items)

    assert (applied, skipped) == (2, 1)


def test_apply_item_rejects_invalid_extra_shapes() -> None:
    writer = RenPyWriter()
    lines, item_bad = build_valid_case()
    item_bad.set_extra_field({"renpy": []})
    assert writer.apply_item(lines[:], item_bad) is False

    lines, item_bad = build_valid_case()
    item_bad.set_extra_field({"renpy": {"pair": [], "digest": {}}})
    assert writer.apply_item(lines[:], item_bad) is False

    lines, item_bad = build_valid_case()
    item_bad.set_extra_field(
        {"renpy": {"pair": {}, "digest": {}, "slots": {}, "block": []}}
    )
    assert writer.apply_item(lines[:], item_bad) is False


def test_apply_item_rejects_invalid_line_and_digest_guards() -> None:
    writer = RenPyWriter()
    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    renpy["pair"] = {"template_line": "1", "target_line": 2}
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    renpy["pair"] = {"template_line": 0, "target_line": 2}
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    renpy["pair"] = {"template_line": 1, "target_line": 99}
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    digest = cast(dict[str, Any], renpy["digest"])
    digest["template_raw_sha1"] = 1
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    digest = cast(dict[str, Any], renpy["digest"])
    digest["target_string_count"] = "1"
    assert writer.apply_item(lines[:], bad) is False


def test_apply_item_rejects_mismatch_and_template_not_comment() -> None:
    writer = RenPyWriter()
    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    digest = cast(dict[str, Any], renpy["digest"])
    digest["template_raw_sha1"] = "bad"
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    digest = cast(dict[str, Any], renpy["digest"])
    digest["target_skeleton_sha1"] = "bad"
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    digest = cast(dict[str, Any], renpy["digest"])
    digest["target_string_count"] = 999
    assert writer.apply_item(lines[:], bad) is False

    lines, bad = build_valid_case()
    renpy = get_renpy_extra(bad)
    renpy["slots"] = [{"role": "NAME", "lit_index": 0}]
    bad.set_name_dst("")
    assert writer.apply_item(lines[:], bad) is False

    _, item = build_valid_case()
    not_comment_lines = ['    e "old"', '    e "old"']
    assert writer.apply_item(not_comment_lines, item) is False


def test_apply_item_supports_strings_block() -> None:
    writer = RenPyWriter()
    lines, item = build_valid_case(kind="STRINGS")
    renpy = get_renpy_extra(item)
    renpy["slots"] = [{"role": "STRING", "lit_index": 0}]

    assert writer.apply_item(lines, item) is True
    assert lines[1] == '    new "new"'


def test_build_replacements_ignores_invalid_slots_and_replaces_known_literals() -> None:
    writer = RenPyWriter()
    item = Item.from_dict({"dst": "台词", "name_dst": ""})

    replacements = writer.build_replacements(
        item,
        [
            "bad-slot",
            {"role": "NAME", "lit_index": "x"},
            {"role": "NAME", "lit_index": 0},
            {"role": "UNKNOWN", "lit_index": 1},
            {"role": "DIALOGUE", "lit_index": 2},
        ],
    )
    assert replacements == {2: "台词"}

    assert writer.replace_literals_by_index("no literal", {0: "x"}) == "no literal"
    replaced = writer.replace_literals_by_index('e "a" "b"', {0: "x"})
    assert replaced == 'e "x" "b"'


def test_apply_item_rejects_label_when_template_line_is_not_comment() -> None:
    writer = RenPyWriter()
    lines = ['    e "old"', '    e "old"']
    item = build_apply_item(
        lines,
        slots=[{"role": "DIALOGUE", "lit_index": 0}],
    )

    assert writer.apply_item(lines, item) is False
