from __future__ import annotations

from model.Item import Item
from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import scan_double_quoted_literals
from module.File.RenPy.RenPyLexer import sha1_hex
from module.File.RenPy.RenPyWriter import RenPyWriter


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
    template_raw = lines[0]
    target_raw = lines[1]
    target_rest = target_raw.lstrip()
    target_literals = scan_double_quoted_literals(target_rest)
    target_skeleton = build_skeleton(target_rest, target_literals)

    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "extra_field": {
                "renpy": {
                    "pair": {"template_line": 1, "target_line": 2},
                    "digest": {
                        "template_raw_sha1": sha1_hex(template_raw),
                        "target_skeleton_sha1": sha1_hex(target_skeleton),
                        "target_string_count": 1,
                    },
                    "slots": [{"role": "DIALOGUE", "lit_index": 0}],
                    "block": {"kind": "LABEL"},
                }
            },
        }
    )

    ok = writer.apply_item(lines, item)

    assert ok is True
    assert lines[1] == '    e "new"'


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
