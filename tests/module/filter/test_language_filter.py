import pytest

from base.BaseLanguage import BaseLanguage
from module.Filter.LanguageFilter import LanguageFilter


class TestLanguageFilterZH:
    """中文源语言：包含 CJK 字符则不过滤，否则过滤。"""

    def test_contains_cjk_not_filtered(self) -> None:
        assert LanguageFilter.filter("你好世界", BaseLanguage.Enum.ZH) is False

    def test_mixed_cjk_latin_not_filtered(self) -> None:
        assert LanguageFilter.filter("Hello 你好", BaseLanguage.Enum.ZH) is False

    def test_no_cjk_filtered(self) -> None:
        assert LanguageFilter.filter("Hello World", BaseLanguage.Enum.ZH) is True

    def test_only_numbers_filtered(self) -> None:
        assert LanguageFilter.filter("12345", BaseLanguage.Enum.ZH) is True


class TestLanguageFilterEN:
    """英文源语言：包含拉丁字符则不过滤，否则过滤。"""

    def test_contains_latin_not_filtered(self) -> None:
        assert LanguageFilter.filter("Hello World", BaseLanguage.Enum.EN) is False

    def test_mixed_latin_cjk_not_filtered(self) -> None:
        assert LanguageFilter.filter("你好 Hello", BaseLanguage.Enum.EN) is False

    def test_no_latin_filtered(self) -> None:
        assert LanguageFilter.filter("你好世界", BaseLanguage.Enum.EN) is True

    def test_only_numbers_filtered(self) -> None:
        assert LanguageFilter.filter("12345", BaseLanguage.Enum.EN) is True


@pytest.mark.parametrize(
    ("source_language", "text"),
    [
        (BaseLanguage.Enum.JA, "こんにちは"),
        (BaseLanguage.Enum.KO, "안녕하세요"),
        (BaseLanguage.Enum.RU, "Привет"),
        (BaseLanguage.Enum.AR, "مرحبا"),
        (BaseLanguage.Enum.DE, "Straße"),
        (BaseLanguage.Enum.FR, "Bonjour"),
        (BaseLanguage.Enum.PL, "Zażółć gęślą jaźń"),
        (BaseLanguage.Enum.ES, "Hola"),
        (BaseLanguage.Enum.IT, "Città"),
        (BaseLanguage.Enum.PT, "Olá"),
        (BaseLanguage.Enum.HU, "Árvíztűrő"),
        (BaseLanguage.Enum.TR, "İstanbul"),
        (BaseLanguage.Enum.TH, "สวัสดี"),
        (BaseLanguage.Enum.ID, "Bahasa"),
        (BaseLanguage.Enum.VI, "Xin chào"),
    ],
    ids=[
        "JA",
        "KO",
        "RU",
        "AR",
        "DE",
        "FR",
        "PL",
        "ES",
        "IT",
        "PT",
        "HU",
        "TR",
        "TH",
        "ID",
        "VI",
    ],
)
def test_filter_accepts_supported_dynamic_language_codes(
    source_language: BaseLanguage.Enum,
    text: str,
) -> None:
    assert LanguageFilter.filter(text, source_language) is False


@pytest.mark.parametrize(
    ("source_language", "text"),
    [
        (BaseLanguage.Enum.JA, "12345"),
        (BaseLanguage.Enum.KO, "12345"),
        (BaseLanguage.Enum.RU, "12345"),
        (BaseLanguage.Enum.AR, "12345"),
    ],
    ids=["JA", "KO", "RU", "AR"],
)
def test_filter_rejects_text_without_expected_script_for_dynamic_languages(
    source_language: BaseLanguage.Enum,
    text: str,
) -> None:
    assert LanguageFilter.filter(text, source_language) is True


@pytest.mark.parametrize(
    ("source_language", "text", "expected"),
    [
        ("EN", "Hello World", False),
        ("ZH", "你好世界", False),
        ("JA", "こんにちは", False),
        ("ZH", "Hello World", True),
    ],
    ids=["EN_string", "ZH_string", "JA_string", "ZH_string_filtered"],
)
def test_filter_accepts_plain_string_language_code(
    source_language: str,
    text: str,
    expected: bool,
) -> None:
    assert LanguageFilter.filter(text, source_language) is expected


def test_filter_returns_false_when_source_language_is_all() -> None:
    assert LanguageFilter.filter("Hello 你好 123", BaseLanguage.ALL) is False


def test_filter_raises_when_language_code_is_unknown() -> None:
    with pytest.raises(AttributeError):
        LanguageFilter.filter("Hello World", "UNKNOWN")
