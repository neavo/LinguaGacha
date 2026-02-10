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
    def test_is_punctuation(self) -> None:
        assert TextHelper.is_punctuation("。") is True
        assert TextHelper.is_punctuation("!") is True
        assert TextHelper.is_punctuation("·") is True
        assert TextHelper.is_punctuation("A") is False

    def test_any_and_all_punctuation(self) -> None:
        assert TextHelper.any_punctuation("A, B") is True
        assert TextHelper.all_punctuation("!?") is True
        assert TextHelper.all_punctuation("") is True


class TestStripAndSplit:
    def test_strip_punctuation(self) -> None:
        assert TextHelper.strip_punctuation("  ...你好！！  ") == "你好"
        assert TextHelper.strip_punctuation("...！！") == ""

    def test_strip_arabic_numerals(self) -> None:
        assert TextHelper.strip_arabic_numerals("123abc456") == "abc"
        assert TextHelper.strip_arabic_numerals("abc123def") == "abc123def"

    def test_split_by_punctuation_without_space_split(self) -> None:
        assert TextHelper.split_by_punctuation("A,B.C", split_by_space=False) == [
            "A",
            "B",
            "C",
        ]

    def test_split_by_punctuation_with_space_split(self) -> None:
        text = "A B，C\u3000D"
        assert TextHelper.split_by_punctuation(text, split_by_space=True) == [
            "A",
            "B",
            "C",
            "D",
        ]


class TestLengthAndSimilarity:
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

    def test_check_similarity_by_jaccard(self) -> None:
        assert TextHelper.check_similarity_by_jaccard("abc", "abc") == 1.0
        assert TextHelper.check_similarity_by_jaccard("abc", "def") == 0.0
        assert TextHelper.check_similarity_by_jaccard("", "") == 0.0


class TestGetEncoding:
    def test_get_encoding_maps_ascii_to_utf8_sig(self) -> None:
        with patch(
            "module.Text.TextHelper.charset_normalizer.from_bytes",
            return_value=FakeDetectionMatches(FakeDetectionResult("ascii")),
        ):
            assert TextHelper.get_encoding(content=b"hello") == "utf-8-sig"

    def test_get_encoding_uses_path_when_path_and_content_both_exist(self) -> None:
        with (
            patch(
                "module.Text.TextHelper.charset_normalizer.from_path",
                return_value=FakeDetectionMatches(FakeDetectionResult("utf-8")),
            ) as from_path,
            patch(
                "module.Text.TextHelper.charset_normalizer.from_bytes",
                return_value=FakeDetectionMatches(FakeDetectionResult("gbk")),
            ) as from_bytes,
        ):
            assert (
                TextHelper.get_encoding(path="dummy.txt", content=b"hello")
                == "utf-8-sig"
            )
            from_path.assert_called_once_with("dummy.txt")
            from_bytes.assert_not_called()

    def test_get_encoding_keeps_utf8_without_sig_when_disabled(self) -> None:
        with patch(
            "module.Text.TextHelper.charset_normalizer.from_bytes",
            return_value=FakeDetectionMatches(FakeDetectionResult("utf_8")),
        ):
            assert (
                TextHelper.get_encoding(content=b"hello", add_sig_to_utf8=False)
                == "utf_8"
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
