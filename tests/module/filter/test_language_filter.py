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


class TestLanguageFilterOtherLanguages:
    """其他语言通过 getattr 动态获取检测函数。"""

    def test_ja_with_hiragana_not_filtered(self) -> None:
        assert LanguageFilter.filter("こんにちは", BaseLanguage.Enum.JA) is False

    def test_ja_with_katakana_not_filtered(self) -> None:
        assert LanguageFilter.filter("カタカナ", BaseLanguage.Enum.JA) is False

    def test_ja_without_japanese_filtered(self) -> None:
        assert LanguageFilter.filter("12345", BaseLanguage.Enum.JA) is True

    def test_ko_with_hangul_not_filtered(self) -> None:
        assert LanguageFilter.filter("안녕하세요", BaseLanguage.Enum.KO) is False

    def test_ko_without_hangul_filtered(self) -> None:
        assert LanguageFilter.filter("12345", BaseLanguage.Enum.KO) is True

    def test_ru_with_cyrillic_not_filtered(self) -> None:
        assert LanguageFilter.filter("Привет", BaseLanguage.Enum.RU) is False

    def test_ru_without_cyrillic_filtered(self) -> None:
        assert LanguageFilter.filter("12345", BaseLanguage.Enum.RU) is True

    @pytest.mark.parametrize(
        "lang,text",
        [
            (BaseLanguage.Enum.DE, "Straße"),
            (BaseLanguage.Enum.FR, "Bonjour"),
            (BaseLanguage.Enum.ES, "Hola"),
            (BaseLanguage.Enum.TH, "สวัสดี"),
        ],
        ids=["DE", "FR", "ES", "TH"],
    )
    def test_various_languages_with_native_text_not_filtered(
        self, lang: BaseLanguage.Enum, text: str
    ) -> None:
        assert LanguageFilter.filter(text, lang) is False
