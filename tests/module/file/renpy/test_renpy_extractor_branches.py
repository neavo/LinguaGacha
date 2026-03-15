from __future__ import annotations

import pytest

from base.Base import Base
from model.Item import Item
from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import RenPyDocument
from module.File.RenPy.RenPyAst import Slot
from module.File.RenPy.RenPyAst import SlotRole
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyAst import TranslateBlock
from module.File.RenPy.RenPyExtractor import RenPyExtractor
from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import scan_double_quoted_literals


def build_stmt(
    line_no: int,
    code: str,
    stmt_kind: StmtKind,
    block_kind: BlockKind,
) -> StatementNode:
    literals = scan_double_quoted_literals(code)
    skeleton = build_skeleton(code, literals)
    return StatementNode(
        line_no=line_no,
        raw_line=code,
        indent="",
        code=code,
        stmt_kind=stmt_kind,
        block_kind=block_kind,
        literals=literals,
        strict_key=skeleton,
        relaxed_key=skeleton,
        string_count=len(literals),
    )


def build_block(
    label: str,
    kind: BlockKind,
    statements: list[StatementNode],
) -> TranslateBlock:
    return TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label=label,
        kind=kind,
        statements=statements,
    )


def test_extract_covers_skip_missing_none_and_sort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extractor = RenPyExtractor()

    def fake_pair(block: TranslateBlock) -> dict[int, int]:
        del block
        return {10: 20}

    def fake_match(block: TranslateBlock) -> dict[int, int]:
        if block.label == "missing":
            return {30: 40}
        if block.label == "none":
            return {50: 60}
        if block.label == "ok2":
            return {70: 80}
        return {}

    monkeypatch.setattr("module.File.RenPy.RenPyExtractor.pair_old_new", fake_pair)
    monkeypatch.setattr(
        "module.File.RenPy.RenPyExtractor.match_template_to_target",
        fake_match,
    )

    def fake_build_item(
        block: TranslateBlock,
        template_stmt: StatementNode,
        target_stmt: StatementNode,
        rel_path: str,
    ) -> Item | None:
        del block
        del target_stmt
        if template_stmt.line_no == 50:
            return None
        row = 5 if template_stmt.line_no == 10 else 1
        return Item.from_dict(
            {
                "src": f"src-{template_stmt.line_no}",
                "dst": f"dst-{template_stmt.line_no}",
                "row": row,
                "file_type": Item.FileType.RENPY,
                "file_path": rel_path,
            }
        )

    extractor.build_item = fake_build_item

    doc = RenPyDocument(
        lines=[],
        blocks=[
            build_block("py", BlockKind.PYTHON, []),
            build_block(
                "strings",
                BlockKind.STRINGS,
                [
                    build_stmt(10, 'old "a"', StmtKind.TEMPLATE, BlockKind.STRINGS),
                    build_stmt(20, 'new "b"', StmtKind.TARGET, BlockKind.STRINGS),
                ],
            ),
            build_block(
                "missing",
                BlockKind.LABEL,
                [build_stmt(30, 'e "a"', StmtKind.TEMPLATE, BlockKind.LABEL)],
            ),
            build_block(
                "none",
                BlockKind.LABEL,
                [
                    build_stmt(50, 'e "a"', StmtKind.TEMPLATE, BlockKind.LABEL),
                    build_stmt(60, 'e "b"', StmtKind.TARGET, BlockKind.LABEL),
                ],
            ),
            build_block(
                "ok2",
                BlockKind.LABEL,
                [
                    build_stmt(70, 'e "c"', StmtKind.TEMPLATE, BlockKind.LABEL),
                    build_stmt(80, 'e "d"', StmtKind.TARGET, BlockKind.LABEL),
                ],
            ),
        ],
    )

    items = extractor.extract(doc, "z.rpy")

    assert [item.get_src() for item in items] == ["src-70", "src-10"]


def test_build_item_branches_with_monkeypatched_slots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extractor = RenPyExtractor()
    block = build_block("start", BlockKind.LABEL, [])
    template_stmt = build_stmt(
        1, 'e "name" "hello"', StmtKind.TEMPLATE, BlockKind.LABEL
    )
    target_stmt = build_stmt(2, 'e "name" "world"', StmtKind.TARGET, BlockKind.LABEL)

    monkeypatch.setattr(extractor, "select_slots", lambda b, s: [])
    assert extractor.build_item(block, template_stmt, target_stmt, "a.rpy") is None

    monkeypatch.setattr(
        extractor,
        "select_slots",
        lambda b, s: [Slot(role=SlotRole.NAME, lit_index=0)],
    )
    assert extractor.build_item(block, template_stmt, target_stmt, "a.rpy") is None

    monkeypatch.setattr(
        extractor,
        "select_slots",
        lambda b, s: [Slot(role=SlotRole.DIALOGUE, lit_index=99)],
    )
    assert extractor.build_item(block, template_stmt, target_stmt, "a.rpy") is None


def test_get_status_and_get_literal_value() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(1, 'e "a"', StmtKind.TARGET, BlockKind.LABEL)

    assert extractor.get_status("", "x") == Base.ProjectStatus.EXCLUDED
    assert extractor.get_status("a", "b") == Base.ProjectStatus.PROCESSED_IN_PAST
    assert extractor.get_status("a", "a") == Base.ProjectStatus.NONE
    assert extractor.get_literal_value(stmt, -1) == ""
    assert extractor.get_literal_value(stmt, 99) == ""


def test_select_slots_for_strings_covers_all_guards() -> None:
    extractor = RenPyExtractor()

    assert (
        extractor.select_slots_for_strings(
            build_stmt(1, 'new "x"', StmtKind.TARGET, BlockKind.STRINGS)
        )
        == []
    )
    assert (
        extractor.select_slots_for_strings(
            build_stmt(2, "old no_quote", StmtKind.TEMPLATE, BlockKind.STRINGS)
        )
        == []
    )
    assert (
        extractor.select_slots_for_strings(
            build_stmt(3, 'old "bg/a.png"', StmtKind.TEMPLATE, BlockKind.STRINGS)
        )
        == []
    )
    assert (
        extractor.select_slots_for_strings(
            build_stmt(4, 'old "[name]"', StmtKind.TEMPLATE, BlockKind.STRINGS)
        )
        == []
    )


def test_select_slots_for_label_covers_tail_and_name_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extractor = RenPyExtractor()

    assert (
        extractor.select_slots_for_label(
            build_stmt(1, "e no_quote", StmtKind.TEMPLATE, BlockKind.LABEL)
        )
        == []
    )

    stmt = build_stmt(2, 'e "a" "b"', StmtKind.TEMPLATE, BlockKind.LABEL)
    monkeypatch.setattr(extractor, "find_tail_string_group", lambda s: [])
    assert extractor.select_slots_for_label(stmt) == []

    extractor = RenPyExtractor()

    stmt_resource = build_stmt(
        3,
        'e "name" "bg/a.png"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    assert extractor.select_slots_for_label(stmt_resource) == []

    stmt_placeholder = build_stmt(
        4, 'e "name" "[player]"', StmtKind.TEMPLATE, BlockKind.LABEL
    )
    assert extractor.select_slots_for_label(stmt_placeholder) == []

    stmt_tail_name_resource = build_stmt(
        5,
        'e "bg/a.png" "hello"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    slots = extractor.select_slots_for_label(stmt_tail_name_resource)
    assert [v.role for v in slots] == [SlotRole.DIALOGUE]

    stmt_tail_name_placeholder = build_stmt(
        6,
        'e "[name]" "hello"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    slots = extractor.select_slots_for_label(stmt_tail_name_placeholder)
    assert [v.role for v in slots] == [SlotRole.DIALOGUE]


def test_select_slots_and_tail_and_character_helpers() -> None:
    extractor = RenPyExtractor()
    block = build_block("x", BlockKind.PYTHON, [])

    assert (
        extractor.select_slots(
            block, build_stmt(1, 'e "a"', StmtKind.TEMPLATE, BlockKind.LABEL)
        )
        == []
    )
    assert (
        extractor.find_tail_string_group(
            build_stmt(2, "e no_quote", StmtKind.TEMPLATE, BlockKind.LABEL)
        )
        == []
    )

    separated = build_stmt(3, 'e "a", "b"', StmtKind.TEMPLATE, BlockKind.LABEL)
    assert extractor.find_tail_string_group(separated) == [1]

    assert (
        extractor.find_character_name_lit_index(
            build_stmt(4, 'e "a"', StmtKind.TEMPLATE, BlockKind.LABEL)
        )
        is None
    )
    assert (
        extractor.find_character_name_lit_index(
            build_stmt(5, 'Character("a"', StmtKind.TEMPLATE, BlockKind.LABEL)
        )
        is None
    )
    no_lit_inside = build_stmt(
        6,
        "Character(name)",
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    assert extractor.find_character_name_lit_index(no_lit_inside) is None
    open_paren = no_lit_inside.code.find("(")
    close_paren = no_lit_inside.code.rfind(")")
    assert open_paren != -1
    assert close_paren != -1
    assert extractor.find_matching_paren(no_lit_inside, open_paren) == close_paren


def test_extract_returns_empty_when_mapping_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extractor = RenPyExtractor()
    block = build_block(
        "label",
        BlockKind.LABEL,
        [
            build_stmt(1, 'e "a"', StmtKind.TEMPLATE, BlockKind.LABEL),
            build_stmt(2, 'e "b"', StmtKind.TARGET, BlockKind.LABEL),
        ],
    )
    doc = RenPyDocument(lines=[], blocks=[block])

    monkeypatch.setattr(
        "module.File.RenPy.RenPyExtractor.match_template_to_target",
        lambda _: {},
    )

    assert extractor.extract(doc, "a.rpy") == []


def test_select_slots_routes_to_strings_and_returns_valid_string_slot() -> None:
    extractor = RenPyExtractor()
    block = build_block("strings", BlockKind.STRINGS, [])
    stmt = build_stmt(1, 'old "hello"', StmtKind.TEMPLATE, BlockKind.STRINGS)

    slots = extractor.select_slots(block, stmt)

    assert len(slots) == 1
    assert slots[0].role == SlotRole.STRING
    assert slots[0].lit_index == 0


def test_select_slots_for_label_handles_single_tail_dialogue_without_name() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(1, 'e "hello"', StmtKind.TEMPLATE, BlockKind.LABEL)

    slots = extractor.select_slots_for_label(stmt)

    assert [v.role for v in slots] == [SlotRole.DIALOGUE]


def test_select_slots_for_label_keeps_character_name_index_when_present() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(
        2,
        'Character("Alice") "Hello"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    slots = extractor.select_slots_for_label(stmt)

    assert [v.role for v in slots] == [SlotRole.NAME, SlotRole.DIALOGUE]


def test_find_character_name_lit_index_handles_missing_open_paren() -> None:
    extractor = RenPyExtractor()

    class WeirdCode(str):
        def lstrip(self, chars=None):
            del chars
            return "Character("

        def find(
            self,
            sub: str,
            start: object | None = 0,
            end: object | None = None,
        ) -> int:
            del sub
            del start
            del end
            return -1

    stmt = StatementNode(
        line_no=1,
        raw_line="Character",
        indent="",
        code=WeirdCode("Character"),
        stmt_kind=StmtKind.TEMPLATE,
        block_kind=BlockKind.LABEL,
        literals=[],
        strict_key="",
        relaxed_key="",
        string_count=0,
    )

    assert extractor.find_character_name_lit_index(stmt) is None


def test_find_character_name_lit_index_ignores_literals_outside_call() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(3, 'Character(name) "tail"', StmtKind.TEMPLATE, BlockKind.LABEL)

    assert extractor.find_character_name_lit_index(stmt) is None


def test_find_matching_paren_handles_nested_parentheses() -> None:
    extractor = RenPyExtractor()
    stmt = build_stmt(
        4,
        'Character(func("a"))',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    open_pos = stmt.code.find("(")

    assert open_pos != -1
    assert extractor.find_matching_paren(stmt, open_pos) == len(stmt.code) - 1
