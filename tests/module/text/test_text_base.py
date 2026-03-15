import pytest

from module.Text import TextBase


class TestTextBaseCommonBehavior:
    def test_base_char_returns_none(self) -> None:
        base = TextBase.TextBase()

        assert base.char("A") is None

    def test_any_and_all_on_empty_text(self) -> None:
        cjk = TextBase.CJK()

        assert cjk.any("") is False
        assert cjk.all("") is True

    def test_strip_non_target_keeps_middle_non_target_chars(self) -> None:
        cjk = TextBase.CJK()

        assert cjk.strip_non_target("!!你A好??") == "你A好"

    def test_strip_non_target_returns_empty_when_no_target_chars(self) -> None:
        cjk = TextBase.CJK()

        assert cjk.strip_non_target("  !!!???  ") == ""

    def test_strip_non_target_returns_empty_on_blank_input(self) -> None:
        cjk = TextBase.CJK()

        assert cjk.strip_non_target("  \t\n  ") == ""


class TestCJKAndLatin:
    @pytest.mark.parametrize(
        ("char", "expected"),
        [
            ("你", True),
            ("。", False),
            ("A", False),
        ],
    )
    def test_cjk_char(self, char: str, expected: bool) -> None:
        assert TextBase.CJK().char(char) is expected

    @pytest.mark.parametrize(
        ("char", "expected"),
        [
            ("A", True),
            ("é", True),
            ("！", False),
        ],
    )
    def test_latin_char(self, char: str, expected: bool) -> None:
        assert TextBase.Latin().char(char) is expected


class TestJapaneseAndKorean:
    def test_ja_supports_cjk_hiragana_and_katakana(self) -> None:
        ja = TextBase.JA()

        assert ja.char("你") is True
        assert ja.char("あ") is True
        assert ja.char("カ") is True

    def test_ja_katakana_excludes_long_vowel_mark(self) -> None:
        ja = TextBase.JA()

        assert ja.katakana("ー") is False

    def test_ja_hiragana_helpers(self) -> None:
        ja = TextBase.JA()

        assert ja.any_hiragana("abcあ") is True
        assert ja.any_hiragana("ABC") is False
        assert ja.all_hiragana("あい") is True
        assert ja.all_hiragana("あA") is False

    def test_ja_katakana_helpers(self) -> None:
        ja = TextBase.JA()

        assert ja.any_katakana("abcカ") is True
        assert ja.any_katakana("abc") is False
        assert ja.all_katakana("カタ") is True
        assert ja.all_katakana("カあ") is False

    def test_ko_supports_cjk_and_hangul(self) -> None:
        ko = TextBase.KO()

        assert ko.char("你") is True
        assert ko.char("한") is True
        assert ko.char("A") is False

    def test_ko_hangeul_helpers(self) -> None:
        ko = TextBase.KO()

        assert ko.any_hangeul("A한") is True
        assert ko.any_hangeul("ABC") is False
        assert ko.all_hangeul("한국") is True
        assert ko.all_hangeul("한A") is False


class TestOtherLanguageSets:
    @pytest.mark.parametrize(
        ("lang_cls", "sample_char"),
        [
            (TextBase.RU, "Ж"),
            (TextBase.AR, "ع"),
            (TextBase.DE, "ß"),
            (TextBase.FR, "œ"),
            (TextBase.PL, "Ł"),
            (TextBase.ES, "ñ"),
            (TextBase.IT, "è"),
            (TextBase.PT, "ã"),
            (TextBase.HU, "ő"),
            (TextBase.TR, "İ"),
            (TextBase.TH, "ก"),
            (TextBase.ID, "A"),
            (TextBase.VI, "ạ"),
        ],
    )
    def test_language_char_samples(
        self, lang_cls: type[TextBase.TextBase], sample_char: str
    ) -> None:
        assert lang_cls().char(sample_char) is True
