from __future__ import annotations

from module.File.RenPy.RenPyLexer import build_skeleton
from module.File.RenPy.RenPyLexer import escape_renpy_string
from module.File.RenPy.RenPyLexer import is_translatable_text
from module.File.RenPy.RenPyLexer import looks_like_resource_path
from module.File.RenPy.RenPyLexer import normalize_speaker_token
from module.File.RenPy.RenPyLexer import normalize_ws
from module.File.RenPy.RenPyLexer import scan_double_quoted_literals
from module.File.RenPy.RenPyLexer import split_indent
from module.File.RenPy.RenPyLexer import strip_comment_prefix
from module.File.RenPy.RenPyLexer import unescape_renpy_string


def test_split_indent_and_strip_comment_prefix() -> None:
    assert split_indent("  \tabc") == ("  \t", "abc")
    assert strip_comment_prefix("# hello") == (True, "hello")
    assert strip_comment_prefix("no") == (False, "no")


def test_unescape_and_escape_renpy_string() -> None:
    assert unescape_renpy_string(r"a\n\"b") == 'a\n"b'
    assert escape_renpy_string('a"b\nc') == r"a\"b\nc"


def test_scan_double_quoted_literals_and_build_skeleton() -> None:
    code = 'e "hello" + "w\\"o\\nrld"'
    literals = scan_double_quoted_literals(code)

    assert [v.value for v in literals] == ["hello", 'w"o\nrld']
    assert build_skeleton(code, literals) == 'e "{}" + "{}"'


def test_scan_double_quoted_literals_returns_empty_for_unclosed_quote() -> None:
    assert scan_double_quoted_literals('say "broken') == []


def test_normalize_speaker_token_and_normalize_ws() -> None:
    assert normalize_speaker_token('    eileen "hello"') == '    <SPEAKER> "hello"'
    assert normalize_ws(" a\n\tb  c ") == "a b c"


def test_looks_like_resource_path() -> None:
    assert looks_like_resource_path("bg/scene.PNG") is True
    assert looks_like_resource_path("no_ext") is False


def test_is_translatable_text() -> None:
    assert is_translatable_text("hello") is True
    assert is_translatable_text("[player_name]") is False
    assert is_translatable_text("{#language name and font}") is True
