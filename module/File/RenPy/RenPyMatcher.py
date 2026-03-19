import re

from module.File.RenPy.RenPyAst import BlockKind
from module.File.RenPy.RenPyAst import StatementNode
from module.File.RenPy.RenPyAst import StmtKind
from module.File.RenPy.RenPyAst import TranslateBlock
from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import normalize_speaker_token
from module.File.RenPy.RenPyLexer import normalize_ws
from module.File.RenPy.RenPyStatementHelper import find_character_name_lit_index
from module.File.RenPy.RenPyStatementHelper import find_dialogue_string_group


def drop_normalized_speaker(key: str) -> str:
    prefix = "<SPEAKER> "
    if key.startswith(prefix):
        return key.removeprefix(prefix)
    return key


def get_statement_speaker_token(stmt: StatementNode) -> str | None:
    code = stmt.code if stmt.code != "" else stmt.strict_key
    stripped = code.lstrip()
    if stripped.startswith('"') or stripped.startswith("Character("):
        return None

    match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\b", code)
    if match is None:
        return None

    return match.group(1)


def speakers_are_compatible(template: StatementNode, target: StatementNode) -> bool:
    template_speaker = get_statement_speaker_token(template)
    target_speaker = get_statement_speaker_token(target)
    if template_speaker is None and target_speaker is None:
        return True

    return template_speaker == target_speaker


def build_statement_match_signature(stmt: StatementNode) -> tuple[int, str, str]:
    if stmt.block_kind != BlockKind.LABEL or not stmt.literals:
        return stmt.string_count, stmt.strict_key, stmt.relaxed_key

    match_end_col = find_label_match_end_col(stmt)
    if match_end_col >= len(stmt.code):
        return stmt.string_count, stmt.strict_key, stmt.relaxed_key

    trimmed_code = stmt.code[:match_end_col]
    trimmed_literals = [lit for lit in stmt.literals if lit.end_col <= match_end_col]
    strict_key = build_skeleton(trimmed_code, trimmed_literals)
    relaxed_key = normalize_ws(normalize_speaker_token(strict_key))
    return len(trimmed_literals), strict_key, relaxed_key


def find_label_match_end_col(stmt: StatementNode) -> int:
    name_index = find_character_name_lit_index(stmt)
    dialogue_group = find_dialogue_string_group(stmt, name_index)
    if not dialogue_group:
        return len(stmt.code)

    dialogue_index = dialogue_group[-1]
    # 匹配阶段只关心正文和名字，尾部参数交给写回时按模板补回。
    return stmt.literals[dialogue_index].end_col


def statements_equal(template: StatementNode, target: StatementNode) -> bool:
    template_count, template_strict_key, template_relaxed_key = (
        build_statement_match_signature(template)
    )
    target_count, target_strict_key, target_relaxed_key = (
        build_statement_match_signature(target)
    )

    if template_count != target_count:
        return False

    if template_strict_key == target_strict_key:
        return True

    if not speakers_are_compatible(template, target):
        return False

    if template_relaxed_key == target_relaxed_key:
        return True

    if template_strict_key == drop_normalized_speaker(target_relaxed_key):
        return True

    if drop_normalized_speaker(template_relaxed_key) == target_strict_key:
        return True

    return False


def match_template_to_target(block: TranslateBlock) -> dict[int, int]:
    templates = [
        s
        for s in block.statements
        if s.stmt_kind == StmtKind.TEMPLATE and s.strict_key != ""
    ]
    targets = [
        s
        for s in block.statements
        if s.stmt_kind == StmtKind.TARGET and s.strict_key != ""
    ]

    if not templates or not targets:
        return {}

    dp: list[list[int]] = [[0] * (len(targets) + 1) for _ in range(len(templates) + 1)]
    for i in range(len(templates) - 1, -1, -1):
        for j in range(len(targets) - 1, -1, -1):
            if statements_equal(templates[i], targets[j]):
                dp[i][j] = dp[i + 1][j + 1] + 1
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])

    mapping: dict[int, int] = {}
    i = 0
    j = 0
    while i < len(templates) and j < len(targets):
        if statements_equal(templates[i], targets[j]):
            mapping[templates[i].line_no] = targets[j].line_no
            i += 1
            j += 1
            continue

        if dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1

    return mapping


def pair_old_new(block: TranslateBlock) -> dict[int, int]:
    pending_old: int | None = None
    mapping: dict[int, int] = {}

    for stmt in block.statements:
        code = stmt.code.strip()

        if stmt.stmt_kind == StmtKind.TEMPLATE and code.startswith("old "):
            pending_old = stmt.line_no
            continue

        if stmt.stmt_kind == StmtKind.TARGET and code.startswith("new "):
            if pending_old is None:
                continue
            mapping[pending_old] = stmt.line_no
            pending_old = None

    return mapping
