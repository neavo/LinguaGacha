from module.Fixer.KanaFixer import KanaFixer


class TestKanaFixer:
    def test_init_does_not_crash(self) -> None:
        KanaFixer()

    def test_keep_small_kana_when_adjacent_to_kana(self) -> None:
        assert KanaFixer.fix("アっカ") == "アっカ"

    def test_remove_small_kana_between_non_kana(self) -> None:
        assert KanaFixer.fix("AっB") == "AB"

    def test_keep_small_kana_at_start_when_next_is_kana(self) -> None:
        assert KanaFixer.fix("っあ") == "っあ"

    def test_remove_small_kana_at_end_when_prev_is_non_kana(self) -> None:
        assert KanaFixer.fix("Aっ") == "A"
