import hashlib
import os
import re

from model.Item import Item
from module.File.RenPy.RenPyAst import StringLiteral

PLACEHOLDER = '"{}"'


def split_indent(raw_line: str) -> tuple[str, str]:
    i = 0
    while i < len(raw_line) and raw_line[i] in {" ", "\t"}:
        i += 1
    return raw_line[:i], raw_line[i:]


def strip_comment_prefix(text: str) -> tuple[bool, str]:
    if not text.startswith("#"):
        return False, text
    content = text[1:]
    if content.startswith(" "):
        content = content[1:]
    return True, content


def sha1_hex(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def unescape_renpy_string(raw_inner: str) -> str:
    # Minimal unescape to keep behavior close to legacy implementation.
    return raw_inner.replace("\\n", "\n").replace('\\"', '"')


def escape_renpy_string(text: str) -> str:
    # Keep behavior close to legacy implementation: escape quotes and newlines.
    return text.replace("\n", "\\n").replace('\\"', '"').replace('"', '\\"')


def scan_double_quoted_literals(code: str) -> list[StringLiteral]:
    literals: list[StringLiteral] = []
    i = 0
    while i < len(code):
        if code[i] != '"':
            i += 1
            continue

        start = i
        i += 1
        buf: list[str] = []
        while i < len(code):
            ch = code[i]
            if ch == "\\" and i + 1 < len(code):
                buf.append(code[i])
                buf.append(code[i + 1])
                i += 2
                continue
            if ch == '"':
                end = i + 1
                raw_inner = "".join(buf)
                value = unescape_renpy_string(raw_inner)
                literals.append(
                    StringLiteral(
                        start_col=start,
                        end_col=end,
                        raw_inner=raw_inner,
                        value=value,
                    )
                )
                i = end
                break
            buf.append(ch)
            i += 1
        else:
            # Unclosed quote: treat the whole line as unparseable.
            return []

    return literals


def build_skeleton(code: str, literals: list[StringLiteral]) -> str:
    if not literals:
        return normalize_ws(code)

    parts: list[str] = []
    pos = 0
    for lit in literals:
        parts.append(code[pos : lit.start_col])
        parts.append(PLACEHOLDER)
        pos = lit.end_col
    parts.append(code[pos:])
    return normalize_ws("".join(parts))


def normalize_speaker_token(code: str) -> str:
    stripped = code.lstrip()
    if stripped.startswith('"'):
        return code

    m = re.match(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\b.*)$", code)
    if m is None:
        return code
    return f"{m.group(1)}<SPEAKER>{m.group(3)}"


def looks_like_resource_path(text: str) -> bool:
    s = text.strip()
    if s == "":
        return False

    base = os.path.basename(s)
    _, ext = os.path.splitext(base)
    if ext == "":
        return False

    ext_lower = ext.lower()
    resource_exts = {
        ".mp3",
        ".ogg",
        ".wav",
        ".flac",
        ".opus",
        ".mp4",
        ".webm",
        ".avi",
        ".mkv",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".bmp",
        ".ttf",
        ".otf",
        ".woff",
        ".woff2",
    }
    return ext_lower in resource_exts


def strip_renpy_markup(text: str) -> str:
    result = text
    for rule in Item.REGEX_RENPY:
        result = rule.sub("", result)
    return result


def is_translatable_text(text: str) -> bool:
    s = text.strip()
    if s == "":
        return False

    # Pure [var] strings are usually runtime placeholders.
    if re.fullmatch(r"\[[^\]]+\]", s) is not None:
        return False

    cleaned = strip_renpy_markup(text).strip()
    if cleaned != "":
        return True

    # Strings like "{#language name and font}" are meant to be translated.
    if "{#" in s:
        return True

    return False
