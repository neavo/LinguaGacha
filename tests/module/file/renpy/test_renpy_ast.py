from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import RenPyDocument
from module.File.RenPy.RenPyAst import Slot
from module.File.RenPy.RenPyAst import SlotRole
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyAst import StringLiteral
from module.File.RenPy.RenPyAst import TranslateBlock


def test_enums_expose_expected_values() -> None:
    assert BlockKind.LABEL == "LABEL"
    assert StmtKind.TARGET == "TARGET"
    assert SlotRole.STRING == "STRING"


def test_ast_dataclasses_build_document_tree() -> None:
    literal = StringLiteral(
        start_col=4,
        end_col=9,
        raw_inner="hello",
        value="hello",
    )
    statement = StatementNode(
        line_no=3,
        raw_line='    "hello"',
        indent="    ",
        code='"hello"',
        stmt_kind=StmtKind.TARGET,
        block_kind=BlockKind.STRINGS,
        literals=[literal],
        strict_key="k1",
        relaxed_key="k2",
        string_count=1,
    )
    slot = Slot(role=SlotRole.DIALOGUE, lit_index=0)
    block = TranslateBlock(
        header_line_no=1,
        lang="zh",
        label="demo",
        kind=BlockKind.STRINGS,
        statements=[statement],
    )
    document = RenPyDocument(lines=["line1"], blocks=[block])

    assert slot.role == SlotRole.DIALOGUE
    assert slot.lit_index == 0
    assert statement.literals[0].value == "hello"
    assert document.blocks[0].statements[0].strict_key == "k1"
