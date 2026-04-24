from __future__ import annotations

from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyAst import TranslateBlock
from module.File.RenPy.RenPyMatcher import drop_normalized_speaker
from module.File.RenPy.RenPyMatcher import get_statement_speaker_token
from module.File.RenPy.RenPyMatcher import match_template_to_target
from module.File.RenPy.RenPyMatcher import pair_old_new
from module.File.RenPy.RenPyMatcher import speakers_are_compatible
from module.File.RenPy.RenPyMatcher import statements_equal


def build_stmt(
    line_no: int,
    stmt_kind: StmtKind,
    strict_key: str,
    relaxed_key: str,
    code: str = "",
    string_count: int = 1,
) -> StatementNode:
    return StatementNode(
        line_no=line_no,
        raw_line=code,
        indent="",
        code=code,
        stmt_kind=stmt_kind,
        block_kind=BlockKind.LABEL,
        literals=[],
        strict_key=strict_key,
        relaxed_key=relaxed_key,
        string_count=string_count,
    )


def test_statements_equal_accepts_speaker_normalization() -> None:
    template = build_stmt(1, StmtKind.TEMPLATE, '"{}"', '<SPEAKER> "{}"')
    target = build_stmt(2, StmtKind.TARGET, '"{}"', '"{}"')

    assert statements_equal(template, target) is True


def test_match_template_to_target_returns_lcs_mapping() -> None:
    block = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="start",
        kind=BlockKind.LABEL,
        statements=[
            build_stmt(2, StmtKind.TEMPLATE, '"{}"', '"{}"'),
            build_stmt(3, StmtKind.TEMPLATE, '"x{}"', '"x{}"'),
            build_stmt(10, StmtKind.TARGET, '"{}"', '"{}"'),
            build_stmt(11, StmtKind.TARGET, '"x{}"', '"x{}"'),
        ],
    )

    mapping = match_template_to_target(block)

    assert mapping == {2: 10, 3: 11}


def test_pair_old_new_only_pairs_valid_sequence() -> None:
    block = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="strings",
        kind=BlockKind.STRINGS,
        statements=[
            build_stmt(2, StmtKind.TEMPLATE, "", "", 'old "a"'),
            build_stmt(3, StmtKind.TARGET, "", "", 'new "b"'),
            build_stmt(4, StmtKind.TARGET, "", "", 'new "orphan"'),
        ],
    )

    assert pair_old_new(block) == {2: 3}


def test_drop_normalized_speaker_removes_prefix_only_when_present() -> None:
    assert drop_normalized_speaker('<SPEAKER> "a"') == '"a"'
    assert drop_normalized_speaker('"a"') == '"a"'


def test_get_statement_speaker_token_distinguishes_identifier_and_plain_string() -> (
    None
):
    assert (
        get_statement_speaker_token(
            build_stmt(1, StmtKind.TEMPLATE, 'n "{}"', "", 'n ""')
        )
        == "n"
    )
    assert (
        get_statement_speaker_token(build_stmt(2, StmtKind.TEMPLATE, '"{}"', "", '""'))
        is None
    )


def test_speakers_are_compatible_requires_same_identifier_speaker() -> None:
    narrator = build_stmt(1, StmtKind.TEMPLATE, 'n "{}"', "", 'n ""')
    reporter = build_stmt(2, StmtKind.TARGET, 'r "{}"', "", 'r ""')
    plain = build_stmt(3, StmtKind.TARGET, '"{}"', "", '""')

    assert speakers_are_compatible(narrator, narrator) is True
    assert speakers_are_compatible(narrator, reporter) is False
    assert speakers_are_compatible(narrator, plain) is False


def test_statements_equal_matches_normalized_speakers_and_rejects_mismatches() -> None:
    assert (
        statements_equal(
            build_stmt(1, StmtKind.TEMPLATE, "a", "a", string_count=1),
            build_stmt(2, StmtKind.TARGET, "a", "x", string_count=1),
        )
        is True
    )

    assert (
        statements_equal(
            build_stmt(1, StmtKind.TEMPLATE, '"a"', "r", '"a"', string_count=1),
            build_stmt(2, StmtKind.TARGET, '"b"', "r", '"b"', string_count=1),
        )
        is True
    )

    assert (
        statements_equal(
            build_stmt(
                1,
                StmtKind.TEMPLATE,
                'e "{}"',
                '<SPEAKER> "{}"',
                'e ""',
                string_count=1,
            ),
            build_stmt(
                2,
                StmtKind.TARGET,
                'e "{}"',
                '<SPEAKER> "{}"',
                'e ""',
                string_count=1,
            ),
        )
        is True
    )

    assert (
        statements_equal(
            build_stmt(
                1,
                StmtKind.TEMPLATE,
                '"{}"',
                '"{}"',
                '""',
                string_count=1,
            ),
            build_stmt(
                2,
                StmtKind.TARGET,
                'n "{}"',
                '<SPEAKER> "{}"',
                'n ""',
                string_count=1,
            ),
        )
        is False
    )

    assert (
        statements_equal(
            build_stmt(1, StmtKind.TEMPLATE, "a", "a", string_count=2),
            build_stmt(2, StmtKind.TARGET, "a", "a", string_count=1),
        )
        is False
    )

    assert (
        statements_equal(
            build_stmt(1, StmtKind.TEMPLATE, "a", "a", string_count=1),
            build_stmt(2, StmtKind.TARGET, "b", "b", string_count=1),
        )
        is False
    )


def test_match_template_to_target_returns_empty_when_missing_side() -> None:
    only_templates = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="start",
        kind=BlockKind.LABEL,
        statements=[build_stmt(2, StmtKind.TEMPLATE, '"{}"', '"{}"')],
    )
    only_targets = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="start",
        kind=BlockKind.LABEL,
        statements=[build_stmt(10, StmtKind.TARGET, '"{}"', '"{}"')],
    )

    assert match_template_to_target(only_templates) == {}
    assert match_template_to_target(only_targets) == {}


def test_match_template_to_target_can_skip_target_first_using_dp_else_branch() -> None:
    block = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="start",
        kind=BlockKind.LABEL,
        statements=[
            build_stmt(2, StmtKind.TEMPLATE, "A", "A"),
            build_stmt(3, StmtKind.TEMPLATE, "B", "B"),
            build_stmt(10, StmtKind.TARGET, "X", "X"),
            build_stmt(11, StmtKind.TARGET, "A", "A"),
            build_stmt(12, StmtKind.TARGET, "B", "B"),
        ],
    )

    mapping = match_template_to_target(block)

    assert mapping == {2: 11, 3: 12}


def test_match_template_to_target_can_skip_template_first_using_dp_i_branch() -> None:
    block = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="start",
        kind=BlockKind.LABEL,
        statements=[
            build_stmt(2, StmtKind.TEMPLATE, "A", "A"),
            build_stmt(3, StmtKind.TEMPLATE, "B", "B"),
            build_stmt(10, StmtKind.TARGET, "B", "B"),
        ],
    )

    mapping = match_template_to_target(block)

    assert mapping == {3: 10}


def test_match_template_to_target_does_not_cross_match_plain_and_named_speaker() -> (
    None
):
    text = """translate schinese start_b2fba8d0:

    # "[player_name]"
    n ""
    # r "Hello"
    r ""
""".splitlines()
    from module.File.RenPy.RenPyParser import parse_document

    doc = parse_document(text)

    assert match_template_to_target(doc.blocks[0]) == {5: 6}


def test_pair_old_new_ignores_non_new_targets() -> None:
    block = TranslateBlock(
        header_line_no=1,
        lang="chinese",
        label="strings",
        kind=BlockKind.STRINGS,
        statements=[
            build_stmt(2, StmtKind.TEMPLATE, "", "", 'old "a"'),
            build_stmt(3, StmtKind.TARGET, "", "", 'say "ignore"'),
            build_stmt(4, StmtKind.TARGET, "", "", 'new "b"'),
        ],
    )

    assert pair_old_new(block) == {2: 4}
