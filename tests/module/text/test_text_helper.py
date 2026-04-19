from unittest.mock import patch

import pytest

from module.Text.TextHelper import TextHelper


class FakeDetectionResult:
    def __init__(self, encoding: str) -> None:
        self.encoding = encoding


class FakeDetectionMatches:
    def __init__(self, result: FakeDetectionResult | None) -> None:
        self.result = result

    def best(self) -> FakeDetectionResult | None:
        return self.result


class TestPunctuationChecks:
    @pytest.mark.parametrize(
        ("char", "expected"),
        [
            ("。", True),
            ("!", True),
            ("·", True),
            ("A", False),
        ],
    )
    def test_is_punctuation(self, char: str, expected: bool) -> None:
        assert TextHelper.is_punctuation(char) is expected

    def test_type_specific_punctuation_checks(self) -> None:
        assert TextHelper.is_cjk_punctuation("。") is True
        assert TextHelper.is_latin_punctuation("!") is True
        assert TextHelper.is_special_punctuation("♥") is True
        assert TextHelper.is_special_punctuation("。") is False

    def test_any_and_all_punctuation(self) -> None:
        assert TextHelper.any_punctuation("A, B") is True
        assert TextHelper.all_punctuation("!?") is True
        assert TextHelper.all_punctuation("") is True


class TestStripHelpers:
    def test_strip_punctuation(self) -> None:
        assert TextHelper.strip_punctuation("  ...你好！！  ") == "你好"
        assert TextHelper.strip_punctuation("...！！") == ""

    def test_strip_punctuation_returns_empty_for_whitespace_only(self) -> None:
        assert TextHelper.strip_punctuation("   ") == ""

    def test_strip_arabic_numerals(self) -> None:
        assert TextHelper.strip_arabic_numerals("123abc456") == "abc"
        assert TextHelper.strip_arabic_numerals("abc123def") == "abc123def"


class TestSplitByPunctuation:
    @pytest.mark.parametrize(
        ("text", "split_by_space", "expected"),
        [
            ("A,B.C", False, ["A", "B", "C"]),
            ("A B，C\u3000D", True, ["A", "B", "C", "D"]),
            ("，，A,,B！！", False, ["A", "B"]),
            ("，， !! \u3000", True, []),
        ],
    )
    def test_split_by_punctuation(
        self,
        text: str,
        split_by_space: bool,
        expected: list[str],
    ) -> None:
        assert TextHelper.split_by_punctuation(text, split_by_space) == expected


class TestSimilarity:
    @pytest.mark.parametrize(
        ("left", "right", "expected"),
        [
            ("abc", "abc", 1.0),
            ("abc", "def", 0.0),
            ("ab", "bc", 1 / 3),
            ("", "", 0.0),
        ],
    )
    def test_check_similarity_by_jaccard(
        self,
        left: str,
        right: str,
        expected: float,
    ) -> None:
        assert TextHelper.check_similarity_by_jaccard(left, right) == pytest.approx(
            expected
        )


class TestDisplayLength:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("abc", 3),
            ("你好", 4),
            ("a你", 3),
        ],
    )
    def test_get_display_lenght(self, text: str, expected: int) -> None:
        assert TextHelper.get_display_lenght(text) == expected


class TestGetEncoding:
    @pytest.mark.parametrize(
        ("detected", "add_sig_to_utf8", "expected"),
        [
            ("ascii", True, "utf-8-sig"),
            ("utf_8", False, "utf_8"),
            ("gbk", True, "gbk"),
        ],
    )
    def test_get_encoding_normalizes_detector_result(
        self,
        detected: str,
        add_sig_to_utf8: bool,
        expected: str,
    ) -> None:
        with patch(
            "module.Text.TextHelper.charset_normalizer.from_bytes",
            return_value=FakeDetectionMatches(FakeDetectionResult(detected)),
        ):
            assert (
                TextHelper.get_encoding(
                    content=b"hello",
                    add_sig_to_utf8=add_sig_to_utf8,
                )
                == expected
            )

    def test_get_encoding_falls_back_when_detection_errors(self) -> None:
        with patch(
            "module.Text.TextHelper.charset_normalizer.from_bytes",
            side_effect=RuntimeError("boom"),
        ):
            assert TextHelper.get_encoding(content=b"hello") == "utf-8-sig"

    def test_get_encoding_falls_back_when_best_returns_none(self) -> None:
        with patch(
            "module.Text.TextHelper.charset_normalizer.from_bytes",
            return_value=FakeDetectionMatches(None),
        ):
            assert TextHelper.get_encoding(content=b"hello") == "utf-8-sig"

    def test_get_encoding_uses_path_when_path_and_content_both_exist(self) -> None:
        with (
            patch(
                "module.Text.TextHelper.charset_normalizer.from_path",
                return_value=FakeDetectionMatches(FakeDetectionResult("utf-8")),
            ),
            patch(
                "module.Text.TextHelper.charset_normalizer.from_bytes",
                return_value=FakeDetectionMatches(FakeDetectionResult("gbk")),
            ),
        ):
            assert (
                TextHelper.get_encoding(path="dummy.txt", content=b"hello")
                == "utf-8-sig"
            )

    def test_get_encoding_falls_back_when_path_best_returns_none(self) -> None:
        with patch(
            "module.Text.TextHelper.charset_normalizer.from_path",
            return_value=FakeDetectionMatches(None),
        ):
            assert TextHelper.get_encoding(path="dummy.txt") == "utf-8-sig"

    def test_get_encoding_uses_default_when_no_input(self) -> None:
        assert TextHelper.get_encoding(path=None, content=None) == "utf-8-sig"
