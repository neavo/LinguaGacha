import pytest

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

    @pytest.mark.parametrize(
        ("src", "dst"),
        [
            ("奖励②", "Reward 1"),
            ("①", "㊿"),
            ("奖励①", "Reward 99"),
        ],
    )
    def test_return_original_when_circled_number_cannot_be_safely_restored(
        self, src: str, dst: str
    ) -> None:
        assert NumberFixer.fix(src, dst) == dst
