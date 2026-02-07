import dataclasses
from enum import StrEnum
from typing import Literal


class BlockKind(StrEnum):
    LABEL = "LABEL"
    STRINGS = "STRINGS"
    PYTHON = "PYTHON"
    OTHER = "OTHER"


class StmtKind(StrEnum):
    TEMPLATE = "TEMPLATE"  # comment template line ("    # ...") or "old ..."
    TARGET = "TARGET"  # non-comment statement inside translate block
    META = "META"  # location/comment line not participating in matching
    BLANK = "BLANK"
    OTHER = "OTHER"


class SlotRole(StrEnum):
    DIALOGUE = "DIALOGUE"
    NAME = "NAME"
    STRING = "STRING"  # translate ... strings: old/new


@dataclasses.dataclass(frozen=True)
class StringLiteral:
    start_col: int
    end_col: int
    raw_inner: str
    value: str
    quote: Literal['"'] = '"'


@dataclasses.dataclass(frozen=True)
class Slot:
    role: SlotRole
    lit_index: int


@dataclasses.dataclass
class StatementNode:
    line_no: int  # 1-based
    raw_line: str
    indent: str
    code: str
    stmt_kind: StmtKind
    block_kind: BlockKind
    literals: list[StringLiteral]
    strict_key: str
    relaxed_key: str
    string_count: int


@dataclasses.dataclass
class TranslateBlock:
    header_line_no: int
    lang: str
    label: str
    kind: BlockKind
    statements: list[StatementNode]


@dataclasses.dataclass
class RenPyDocument:
    lines: list[str]
    blocks: list[TranslateBlock]
