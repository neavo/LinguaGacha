from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import scan_double_quoted_literals
from module.File.RenPy.RenPyStatementHelper import find_character_name_lit_index
from module.File.RenPy.RenPyStatementHelper import find_dialogue_string_group
from module.File.RenPy.RenPyStatementHelper import find_first_string_after_col
from module.File.RenPy.RenPyStatementHelper import find_matching_paren
from module.File.RenPy.RenPyStatementHelper import get_dialogue_start_col


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


def test_find_character_name_lit_index_ignores_parentheses_inside_literals() -> None:
    stmt = build_stmt(
        1,
        'Character("Ali(ce)", who_color="#fff")',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert find_character_name_lit_index(stmt) == 0


def test_find_dialogue_string_group_handles_character_prefix_and_gaps() -> None:
    separated_stmt = build_stmt(
        2,
        'e "name", "tail"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    character_stmt = build_stmt(
        3,
        'Character("Alice") "tail" (cb_name="x")',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert find_dialogue_string_group(separated_stmt) == [0]
    assert find_dialogue_string_group(character_stmt, 0) == [1]


def test_find_dialogue_string_group_returns_empty_for_invalid_start() -> None:
    no_quote_stmt = build_stmt(4, "e no_quote", StmtKind.TEMPLATE, BlockKind.LABEL)
    broken_character_stmt = build_stmt(
        5,
        'Character("Alice"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert find_dialogue_string_group(no_quote_stmt) == []
    assert find_dialogue_string_group(broken_character_stmt, 0) == []


def test_find_dialogue_string_group_returns_empty_when_character_has_no_tail() -> None:
    stmt = build_stmt(
        6,
        'Character("Alice")',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert find_dialogue_string_group(stmt, 0) == []


def test_find_first_string_after_col_returns_none_when_start_is_too_late() -> None:
    stmt = build_stmt(
        7,
        'Character("Alice") "tail"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert find_first_string_after_col(stmt, 100) is None


def test_find_character_name_lit_index_returns_none_for_invalid_character_calls() -> (
    None
):
    non_character_stmt = build_stmt(
        8,
        'e "Alice"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    missing_close_stmt = build_stmt(
        9,
        'Character("Alice"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    no_literal_inside_stmt = build_stmt(
        10,
        "Character(name)",
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    literal_outside_stmt = build_stmt(
        11,
        'Character(name) "tail"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert find_character_name_lit_index(non_character_stmt) is None
    assert find_character_name_lit_index(missing_close_stmt) is None
    assert find_character_name_lit_index(no_literal_inside_stmt) is None
    assert find_character_name_lit_index(literal_outside_stmt) is None


def test_find_character_name_lit_index_returns_none_when_open_paren_cannot_be_located() -> (
    None
):
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
        line_no=12,
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

    assert find_character_name_lit_index(stmt) is None


def test_find_matching_paren_handles_nested_parentheses() -> None:
    stmt = build_stmt(
        13,
        'Character(func("a"))',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )
    open_pos = stmt.code.find("(")

    assert open_pos != -1
    assert find_matching_paren(stmt, open_pos) == len(stmt.code) - 1


def test_get_dialogue_start_col_returns_none_when_code_has_no_open_paren() -> None:
    stmt = build_stmt(
        14,
        'e "Alice"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert get_dialogue_start_col(stmt, 0) is None


def test_get_dialogue_start_col_returns_none_for_broken_character_call() -> None:
    stmt = build_stmt(
        15,
        'Character("Alice"',
        StmtKind.TEMPLATE,
        BlockKind.LABEL,
    )

    assert get_dialogue_start_col(stmt, 0) is None
