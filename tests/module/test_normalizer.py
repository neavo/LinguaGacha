from module.Normalizer import Normalizer


class TestNormalizer:
    def test_normalize_converts_fullwidth_alnum(self) -> None:
        assert Normalizer.normalize("ＡＢＣ１２３") == "ABC123"

    def test_normalize_converts_halfwidth_katakana(self) -> None:
        assert Normalizer.normalize("ｱｲｳ") == "アイウ"

    def test_normalize_applies_nfc(self) -> None:
        assert Normalizer.normalize("Cafe\u0301") == "Café"
