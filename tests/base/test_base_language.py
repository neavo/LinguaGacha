from __future__ import annotations

import pytest

from base.BaseLanguage import BaseLanguage


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        (BaseLanguage.Enum.ZH, True),
        (BaseLanguage.Enum.JA, True),
        (BaseLanguage.Enum.KO, True),
        (BaseLanguage.Enum.EN, False),
        ("UNKNOWN", False),
    ],
)
def test_is_cjk_only_marks_cjk_languages(
    language: BaseLanguage.Enum | str,
    expected: bool,
) -> None:
    assert BaseLanguage.is_cjk(language) is expected


@pytest.mark.parametrize(
    ("language", "expected_zh", "expected_en"),
    [
        (BaseLanguage.Enum.EN, "英文", "English"),
        (BaseLanguage.Enum.ZH, "中文", "Chinese"),
        (BaseLanguage.Enum.VI, "越南文", "Vietnamese"),
    ],
)
def test_get_name_methods_return_localized_language_labels(
    language: BaseLanguage.Enum,
    expected_zh: str,
    expected_en: str,
) -> None:
    assert BaseLanguage.get_name_zh(language) == expected_zh
    assert BaseLanguage.get_name_en(language) == expected_en


def test_get_name_methods_return_empty_string_for_unknown_language() -> None:
    assert BaseLanguage.get_name_zh("UNKNOWN") == ""
    assert BaseLanguage.get_name_en("UNKNOWN") == ""


def test_get_languages_returns_all_configured_language_enums() -> None:
    assert BaseLanguage.get_languages() == list(BaseLanguage.LANGUAGE_NAMES.keys())
