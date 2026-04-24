import pytest

from module.Fixer.KanaFixer import KanaFixer


class TestKanaFixer:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("アっカ", "アっカ"),
            ("っあ", "っあ"),
        ],
    )
    def test_keep_small_kana_when_adjacent_to_kana(
        self, text: str, expected: str
    ) -> None:
        assert KanaFixer.fix(text) == expected

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("AっB", "AB"),
            ("Aっ", "A"),
        ],
    )
    def test_remove_small_kana_without_kana_neighbor(
        self, text: str, expected: str
    ) -> None:
        assert KanaFixer.fix(text) == expected

    def test_keep_regular_kana_text_unchanged(self) -> None:
        assert KanaFixer.fix("かなカナ") == "かなカナ"
