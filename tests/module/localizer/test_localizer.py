import pytest

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


@pytest.fixture(autouse=True)
def reset_app_language(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Localizer, "APP_LANGUAGE", BaseLanguage.Enum.ZH)


@pytest.mark.parametrize(
    ("app_language", "expected_bundle", "expected_task_failed"),
    [
        (BaseLanguage.Enum.ZH, LocalizerZH, LocalizerZH.task_failed),
        (BaseLanguage.Enum.EN, LocalizerEN, LocalizerEN.task_failed),
        (BaseLanguage.Enum.JA, LocalizerZH, LocalizerZH.task_failed),
    ],
)
def test_get_returns_expected_bundle_for_selected_language(
    app_language: BaseLanguage.Enum,
    expected_bundle: type[LocalizerZH],
    expected_task_failed: str,
) -> None:
    # Arrange
    Localizer.set_app_language(app_language)

    # Act
    bundle = Localizer.get()

    # Assert
    assert bundle is expected_bundle
    assert bundle.task_failed == expected_task_failed


def test_get_app_language_returns_latest_public_state() -> None:
    # Arrange
    Localizer.set_app_language(BaseLanguage.Enum.EN)

    # Act
    current_language = Localizer.get_app_language()

    # Assert
    assert current_language == BaseLanguage.Enum.EN
