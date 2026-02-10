from module.Fixer.HangeulFixer import HangeulFixer


class TestHangeulFixer:
    def test_keep_onomatopoeia_when_adjacent_to_hangeul(self) -> None:
        assert HangeulFixer.fix("가뿅나") == "가뿅나"

    def test_remove_onomatopoeia_between_non_hangeul(self) -> None:
        assert HangeulFixer.fix("A뿅B") == "AB"

    def test_keep_onomatopoeia_at_start_when_next_is_hangeul(self) -> None:
        assert HangeulFixer.fix("뿅가") == "뿅가"

    def test_remove_onomatopoeia_at_end_when_prev_is_non_hangeul(self) -> None:
        assert HangeulFixer.fix("A뿅") == "A"
