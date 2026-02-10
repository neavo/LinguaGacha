from __future__ import annotations

from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyParser import classify_block_kind
from module.File.RenPy.RenPyParser import is_meta_comment_content
from module.File.RenPy.RenPyParser import parse_document
from module.File.RenPy.RenPyParser import parse_statement
from module.File.RenPy.RenPyParser import parse_translate_header


def test_parse_translate_header() -> None:
    assert parse_translate_header("translate chinese start:") == ("chinese", "start")
    assert parse_translate_header("translate bad") is None


def test_classify_block_kind() -> None:
    assert classify_block_kind("strings") == BlockKind.STRINGS
    assert classify_block_kind("python") == BlockKind.PYTHON
    assert classify_block_kind("label_1") == BlockKind.LABEL


def test_is_meta_comment_content() -> None:
    assert is_meta_comment_content("TODO: here") is True
    assert is_meta_comment_content("game/script.rpy:10") is True
    assert is_meta_comment_content("normal comment") is False


def test_parse_statement_for_strings_old_and_new() -> None:
    old_stmt = parse_statement(2, '    old "hello"', BlockKind.STRINGS)
    new_stmt = parse_statement(3, '    new "world"', BlockKind.STRINGS)

    assert old_stmt.stmt_kind == StmtKind.TEMPLATE
    assert new_stmt.stmt_kind == StmtKind.TARGET
    assert old_stmt.string_count == 1
    assert new_stmt.strict_key == 'new "{}"'


def test_parse_statement_comment_template() -> None:
    stmt = parse_statement(1, '    # alice "hi"', BlockKind.LABEL)

    assert stmt.stmt_kind == StmtKind.TEMPLATE
    assert stmt.code == 'alice "hi"'
    assert stmt.relaxed_key == '<SPEAKER> "{}"'


def test_parse_document_collects_translate_blocks() -> None:
    lines = [
        "translate chinese strings:",
        '    old "a"',
        '    new "b"',
        "translate chinese label_x:",
        '    # alice "c"',
        '    alice "d"',
    ]

    doc = parse_document(lines)

    assert len(doc.blocks) == 2
    assert doc.blocks[0].kind == BlockKind.STRINGS
    assert doc.blocks[1].kind == BlockKind.LABEL
    assert doc.blocks[1].statements[1].stmt_kind == StmtKind.TARGET
