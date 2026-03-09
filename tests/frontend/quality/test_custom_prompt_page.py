from types import SimpleNamespace
from unittest.mock import MagicMock

from frontend.Quality.CustomPromptPage import CustomPromptPage


def build_prompt_page() -> CustomPromptPage:
    page = CustomPromptPage.__new__(CustomPromptPage)
    page.main_text = SimpleNamespace(toPlainText=lambda: "  当前提示词  ")
    page.set_prompt_data = MagicMock()
    page.set_prompt_enable = MagicMock()
    return page


def test_persist_editor_prompt_data_trims_and_saves_when_project_loaded(
    monkeypatch,
) -> None:
    page = build_prompt_page()
    monkeypatch.setattr(
        "frontend.Quality.CustomPromptPage.DataManager.get",
        lambda: SimpleNamespace(is_loaded=lambda: True),
    )

    result = page.persist_editor_prompt_data()

    assert result == "当前提示词"
    page.set_prompt_data.assert_called_once_with("当前提示词")


def test_persist_editor_prompt_data_skips_write_when_project_unloaded(
    monkeypatch,
) -> None:
    page = build_prompt_page()
    monkeypatch.setattr(
        "frontend.Quality.CustomPromptPage.DataManager.get",
        lambda: SimpleNamespace(is_loaded=lambda: False),
    )

    result = page.persist_editor_prompt_data()

    assert result == "当前提示词"
    page.set_prompt_data.assert_not_called()


def test_persist_editor_prompt_data_and_enable_saves_before_enable(
    monkeypatch,
) -> None:
    page = build_prompt_page()
    order: list[tuple[str, object]] = []
    page.set_prompt_data = MagicMock(
        side_effect=lambda text: order.append(("data", text))
    )
    page.set_prompt_enable = MagicMock(
        side_effect=lambda enable: order.append(("enable", enable))
    )
    monkeypatch.setattr(
        "frontend.Quality.CustomPromptPage.DataManager.get",
        lambda: SimpleNamespace(is_loaded=lambda: True),
    )

    page.persist_editor_prompt_data_and_enable(True)

    assert order == [("data", "当前提示词"), ("enable", True)]
