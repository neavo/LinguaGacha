import pytest

from module.Fixer.HangeulFixer import HangeulFixer


class TestHangeulFixer:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("가뿅나", "가뿅나"),
            ("뿅가", "뿅가"),
        ],
    )
    def test_keep_onomatopoeia_when_adjacent_to_hangeul(
        self, text: str, expected: str
    ) -> None:
        assert HangeulFixer.fix(text) == expected

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("A뿅B", "AB"),
            ("A뿅", "A"),
        ],
    )
    def test_remove_onomatopoeia_without_hangeul_neighbor(
        self, text: str, expected: str
    ) -> None:
        assert HangeulFixer.fix(text) == expected

    def test_keep_regular_hangeul_text_unchanged(self) -> None:
        assert HangeulFixer.fix("안녕하세요") == "안녕하세요"
