from module.File.RenPyTL.RenPyTlAst import StatementNode
from module.File.RenPyTL.RenPyTlAst import StmtKind
from module.File.RenPyTL.RenPyTlAst import TranslateBlock


def drop_normalized_speaker(key: str) -> str:
    prefix = "<SPEAKER> "
    if key.startswith(prefix):
        return key.removeprefix(prefix)
    return key


def statements_equal(template: StatementNode, target: StatementNode) -> bool:
    if template.string_count != target.string_count:
        return False

    if template.strict_key == target.strict_key:
        return True

    if template.relaxed_key == target.relaxed_key:
        return True

    if template.strict_key == drop_normalized_speaker(target.relaxed_key):
        return True

    if drop_normalized_speaker(template.relaxed_key) == target.strict_key:
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
