from module.Fixer.NumberFixer import NumberFixer


class TestNumberFixer:
    def test_return_original_when_source_has_no_circled_number(self) -> None:
        src = "奖励1"
        dst = "Reward 1"

        assert NumberFixer.fix(src, dst) == dst

    def test_restore_circled_number_from_digit(self) -> None:
        src = "奖励①"
        dst = "Reward 1"

        assert NumberFixer.fix(src, dst) == "Reward ①"

    def test_restore_multiple_circled_numbers_by_index(self) -> None:
        src = "①和③"
        dst = "1和3"

        assert NumberFixer.fix(src, dst) == "①和③"

    def test_skip_when_digit_value_does_not_match_circled_number(self) -> None:
        src = "奖励②"
        dst = "Reward 1"

        assert NumberFixer.fix(src, dst) == dst
