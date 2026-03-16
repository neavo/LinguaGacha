import pytest

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


@pytest.fixture(autouse=True)
def reset_app_language(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Localizer, "APP_LANGUAGE", BaseLanguage.Enum.ZH)


def test_get_returns_language_specific_localizer_class() -> None:
    Localizer.set_app_language(BaseLanguage.Enum.ZH)
    assert Localizer.get() is LocalizerZH

    Localizer.set_app_language(BaseLanguage.Enum.EN)
    assert Localizer.get() is LocalizerEN


def test_get_falls_back_to_zh_for_non_en_language() -> None:
    Localizer.set_app_language(BaseLanguage.Enum.JA)

    assert Localizer.get() is LocalizerZH


def test_get_app_language_returns_latest_set_value() -> None:
    Localizer.set_app_language(BaseLanguage.Enum.EN)

    assert Localizer.get_app_language() == BaseLanguage.Enum.EN


def test_union_text_resolve_reads_latest_app_language() -> None:
    text = Localizer.UnionText(zh="中文", en="English")

    Localizer.set_app_language(BaseLanguage.Enum.ZH)
    assert text.resolve() == "中文"

    Localizer.set_app_language(BaseLanguage.Enum.EN)
    assert text.resolve() == "English"


@pytest.mark.parametrize(
    ("app_language", "text", "expected"),
    [
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh="中文", en="English"), "English"),
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh="中文", en=None), "中文"),
        (BaseLanguage.Enum.JA, Localizer.UnionText(zh="中文", en="English"), "中文"),
        (BaseLanguage.Enum.JA, Localizer.UnionText(zh=None, en="English"), "English"),
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh=None, en=None), None),
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh="中文", en=""), ""),
        (BaseLanguage.Enum.ZH, Localizer.UnionText(zh="", en="English"), ""),
    ],
)
def test_union_text_resolves_by_app_language(
    app_language: BaseLanguage.Enum,
    text: Localizer.UnionText,
    expected: str | None,
) -> None:
    Localizer.set_app_language(app_language)

    assert text.resolve() == expected


def test_union_text_is_immutable() -> None:
    text = Localizer.UnionText(zh="中文", en="English")

    with pytest.raises(AttributeError):
        text.zh = "修改后中文"
