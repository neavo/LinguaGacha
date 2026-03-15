from pathlib import Path

import pytest

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


class TestLocalizerLanguageSwitch:
    @pytest.fixture(autouse=True)
    def reset_app_language(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(Localizer, "APP_LANGUAGE", BaseLanguage.Enum.ZH)

    def test_get_returns_zh_class_when_language_is_zh(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.ZH)

        assert Localizer.get() is LocalizerZH

    def test_get_returns_en_class_when_language_is_en(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)

        assert Localizer.get() is LocalizerEN

    def test_get_falls_back_to_zh_for_non_en_language(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.JA)

        assert Localizer.get() is LocalizerZH

    def test_get_app_language_returns_latest_set_value(self) -> None:
        Localizer.set_app_language(BaseLanguage.Enum.EN)

        assert Localizer.get_app_language() == BaseLanguage.Enum.EN


class TestLocalizerConsistency:
    def test_en_inherits_from_zh(self) -> None:
        assert issubclass(LocalizerEN, LocalizerZH)

    def test_zh_and_en_have_same_localization_keys(self) -> None:
        assert set(LocalizerZH.__annotations__) == set(LocalizerEN.__annotations__)

    def test_zh_and_en_files_keep_same_line_count(self, fs) -> None:
        project_root = Path(__file__).resolve().parents[3]
        zh_path = project_root / "module" / "Localizer" / "LocalizerZH.py"
        en_path = project_root / "module" / "Localizer" / "LocalizerEN.py"

        fs.add_real_file(str(zh_path), read_only=True)
        fs.add_real_file(str(en_path), read_only=True)

        zh_line_count = len(zh_path.read_text(encoding="utf-8").splitlines())
        en_line_count = len(en_path.read_text(encoding="utf-8").splitlines())

        assert zh_line_count == en_line_count
