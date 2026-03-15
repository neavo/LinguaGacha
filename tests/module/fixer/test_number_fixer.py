from module.Fixer.NumberFixer import NumberFixer


class TestNumberFixer:
    def test_init_does_not_crash(self) -> None:
        NumberFixer()

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

    def test_return_original_when_number_token_count_differs(self) -> None:
        src = "①2"
        dst = "1"

        assert NumberFixer.fix(src, dst) == dst

    def test_return_original_when_destination_has_more_circled_numbers(self) -> None:
        src = "①2"
        dst = "①②"

        assert NumberFixer.fix(src, dst) == dst

    def test_skip_non_circled_source_tokens(self) -> None:
        src = "①2"
        dst = "1 2"

        assert NumberFixer.fix(src, dst) == "① 2"

    def test_safe_int_value_error_skips_restore(self) -> None:
        src = "①"
        dst = "㊿"

        assert NumberFixer.fix(src, dst) == dst
