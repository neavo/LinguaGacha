from dataclasses import FrozenInstanceError

import pytest

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer


class TestLocalizerUnionTextResolve:
    @pytest.fixture(autouse=True)
    def reset_app_language(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(Localizer, "APP_LANGUAGE", BaseLanguage.Enum.ZH)

    def test_resolve_returns_en_when_language_is_en(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        text = Localizer.UnionText(zh="中文", en="English")

        assert text.resolve() == "English"

    def test_resolve_falls_back_to_zh_when_en_is_missing(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        text = Localizer.UnionText(zh="中文", en=None)

        assert text.resolve() == "中文"

    def test_resolve_returns_zh_when_language_is_not_en(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.JA)
        text = Localizer.UnionText(zh="中文", en="English")

        assert text.resolve() == "中文"

    def test_resolve_falls_back_to_en_when_zh_is_missing(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.JA)
        text = Localizer.UnionText(zh=None, en="English")

        assert text.resolve() == "English"

    def test_resolve_returns_none_when_both_text_are_missing(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        text = Localizer.UnionText(zh=None, en=None)

        assert text.resolve() is None

    def test_resolve_keeps_empty_string_for_en_without_fallback(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)
        text = Localizer.UnionText(zh="中文", en="")

        assert text.resolve() == ""

    def test_resolve_keeps_empty_string_for_zh_without_fallback(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.ZH)
        text = Localizer.UnionText(zh="", en="English")

        assert text.resolve() == ""


class TestLocalizerUnionTextFrozen:
    def test_localizer_text_is_immutable(self) -> None:
        text = Localizer.UnionText(zh="中文", en="English")

        with pytest.raises(FrozenInstanceError):
            text.zh = "修改后中文"
