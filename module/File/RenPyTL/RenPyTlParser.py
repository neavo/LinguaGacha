import re

from module.File.RenPyTL.RenPyTlAst import BlockKind
from module.File.RenPyTL.RenPyTlAst import RenPyTlDocument
from module.File.RenPyTL.RenPyTlAst import StatementNode
from module.File.RenPyTL.RenPyTlAst import StmtKind
from module.File.RenPyTL.RenPyTlAst import TranslateBlock
from module.File.RenPyTL.RenPyTlLexer import build_skeleton
from module.File.RenPyTL.RenPyTlLexer import normalize_speaker_token
from module.File.RenPyTL.RenPyTlLexer import normalize_ws
from module.File.RenPyTL.RenPyTlLexer import scan_double_quoted_literals
from module.File.RenPyTL.RenPyTlLexer import split_indent
from module.File.RenPyTL.RenPyTlLexer import strip_comment_prefix


RE_TRANSLATE_HEADER = re.compile(
    r"^translate\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*:\s*$"
)
RE_GAME_LOCATION = re.compile(r"^game/.+?:\d+\s*$")


def parse_translate_header(line: str) -> tuple[str, str] | None:
    m = RE_TRANSLATE_HEADER.match(line.strip())
    if m is None:
        return None
    return m.group(1), m.group(2)


def classify_block_kind(label: str) -> BlockKind:
    if label == "strings":
        return BlockKind.STRINGS
    if label == "python":
        return BlockKind.PYTHON
    return BlockKind.LABEL


def is_meta_comment_content(content: str) -> bool:
    stripped = content.strip()
    if stripped.startswith("TODO:"):
        return True
    return RE_GAME_LOCATION.match(stripped) is not None


def parse_statement(
    line_no: int,
    raw_line: str,
    block_kind: BlockKind,
) -> StatementNode:
    if raw_line.strip() == "":
        return StatementNode(
            line_no=line_no,
            raw_line=raw_line,
            indent="",
            code="",
            stmt_kind=StmtKind.BLANK,
            block_kind=block_kind,
            literals=[],
            strict_key="",
            relaxed_key="",
            string_count=0,
        )

    indent, rest = split_indent(raw_line)
    is_comment, content = strip_comment_prefix(rest)

    stmt_kind = StmtKind.OTHER
    code = rest

    if is_comment:
        code = content
        if indent == "" and is_meta_comment_content(content):
            stmt_kind = StmtKind.META
        elif indent != "" and is_meta_comment_content(content):
            stmt_kind = StmtKind.META
        else:
            stmt_kind = StmtKind.TEMPLATE
    else:
        if block_kind == BlockKind.STRINGS and rest.startswith("old "):
            stmt_kind = StmtKind.TEMPLATE
        elif block_kind == BlockKind.STRINGS and rest.startswith("new "):
            stmt_kind = StmtKind.TARGET
        else:
            stmt_kind = StmtKind.TARGET

    literals = scan_double_quoted_literals(code)
    strict_key = build_skeleton(code, literals)

    relaxed_key = strict_key
    if block_kind == BlockKind.LABEL:
        relaxed_key = normalize_ws(normalize_speaker_token(strict_key))

    return StatementNode(
        line_no=line_no,
        raw_line=raw_line,
        indent=indent,
        code=code,
        stmt_kind=stmt_kind,
        block_kind=block_kind,
        literals=literals,
        strict_key=strict_key,
        relaxed_key=relaxed_key,
        string_count=len(literals),
    )


def parse_document(lines: list[str]) -> RenPyTlDocument:
    blocks: list[TranslateBlock] = []

    i = 0
    while i < len(lines):
        header = parse_translate_header(lines[i])
        if header is None:
            i += 1
            continue

        lang, label = header
        kind = classify_block_kind(label)
        header_line_no = i + 1
        i += 1

        stmts: list[StatementNode] = []
        while i < len(lines):
            if parse_translate_header(lines[i]) is not None:
                break
            stmts.append(parse_statement(i + 1, lines[i], kind))
            i += 1

        blocks.append(
            TranslateBlock(
                header_line_no=header_line_no,
                lang=lang,
                label=label,
                kind=kind,
                statements=stmts,
            )
        )

    # Slot selection happens in extractor after matching.
    return RenPyTlDocument(lines=lines, blocks=blocks)
