from __future__ import annotations

from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import SlotRole
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyAst import TranslateBlock
from module.File.RenPy.RenPyExtractor import RenPyExtractor
from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import scan_double_quoted_literals
from model.Item import Item


def build_stmt(
    line_no: int, code: str, stmt_kind: StmtKind, block_kind: BlockKind
) -> StatementNode:
    literals = scan_double_quoted_literals(code)
    return StatementNode(
        line_no=line_no,
        raw_line=code,
        indent="",
        code=code,
        stmt_kind=stmt_kind,
        block_kind=block_kind,
        literals=literals,
        strict_key=build_skeleton(code, literals),
        relaxed_key=build_skeleton(code, literals),
        string_count=len(literals),
    )


def test_select_slots_for_strings_skips_resource_path() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(1, 'old "bg/scene.png"', StmtKind.TEMPLATE, BlockKind.STRINGS)

    assert extractor.select_slots_for_strings(stmt) == []


def test_select_slots_for_label_uses_tail_group_for_name_and_dialogue() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(2, 'e "Alice" "Hello"', StmtKind.TEMPLATE, BlockKind.LABEL)

    slots = extractor.select_slots_for_label(stmt)

    assert [slot.role for slot in slots] == [SlotRole.NAME, SlotRole.DIALOGUE]
    assert [slot.lit_index for slot in slots] == [0, 1]


def test_find_character_name_lit_index_ignores_parentheses_inside_literals() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(
        3,
        'Character("Ali(ce)", who_color="#fff")',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert extractor.find_character_name_lit_index(stmt) == 0


def test_build_item_sets_status_and_extra_field() -> None:
    extractor = RenPyExtractor()
    block = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="start",
        kind=BlockKind.LABEL,
        statements=[],
    )
    template_stmt = build_stmt(
        10, 'e "Alice" "Hello"', StmtKind.TEMPLATE, BlockKind.LABEL
    )
    target_stmt = build_stmt(11, 'e "Alice" ""', StmtKind.TARGET, BlockKind.LABEL)

    item = extractor.build_item(block, template_stmt, target_stmt, "script.rpy")

    assert isinstance(item, Item)
    assert item.get_src() == "Hello"
    assert item.get_dst() == "Hello"
    assert item.get_name_src() == "Alice"
    assert item.get_name_dst() == "Alice"
    assert "renpy" in item.get_extra_field()
