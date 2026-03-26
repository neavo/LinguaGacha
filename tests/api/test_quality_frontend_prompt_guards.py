from types import SimpleNamespace
from unittest.mock import Mock

from base.Base import Base
import frontend.Quality.CustomPromptPage as custom_prompt_page_module
import frontend.Quality.QualityRulePresetManager as preset_manager_module
from frontend.Quality.CustomPromptPage import CustomPromptPage
from frontend.Quality.QualityRulePresetManager import QualityRulePresetManager
from widget.SettingCard import SettingCard


class FakeDialogButton:
    """最小按钮桩，只保留 setText 接口给对话框装配使用。"""

    def __init__(self) -> None:
        self.text: str = ""

    def setText(self, text: str) -> None:
        self.text = text


class RejectingMessageBox:
    """用于模拟用户拒绝覆盖确认，固定返回 False。"""

    def __init__(self, *args: object, **kwargs: object) -> None:
        del args
        del kwargs
        self.yesButton = FakeDialogButton()
        self.cancelButton = FakeDialogButton()

    def exec(self) -> bool:
        return False


class AutoSubmitLineEditMessageBox:
    """用于自动提交输入框内容，直接驱动回调进入保存/重命名逻辑。"""

    submitted_text: str = ""

    def __init__(
        self,
        parent: object,
        title: str,
        callback,
    ) -> None:
        del parent
        del title
        self.callback = callback
        self.accepted: bool = False
        self.initial_text: str = ""

    def exec(self) -> None:
        self.callback(self, self.submitted_text)

    def accept(self) -> None:
        self.accepted = True

    def get_line_edit(self) -> SimpleNamespace:
        return SimpleNamespace(setText=self.set_initial_text)

    def set_initial_text(self, text: str) -> None:
        self.initial_text = text


def build_quality_rule_preset_manager() -> QualityRulePresetManager:
    page = SimpleNamespace(
        entries=[{"src": "勇者", "dst": "Hero"}],
        emit=Mock(),
    )
    settings_api_client = Mock()
    settings_api_client.get_app_settings.return_value = SimpleNamespace(
        glossary_default_preset=""
    )
    quality_rule_api_client = Mock()
    manager = QualityRulePresetManager(
        "glossary",
        "glossary_default_preset",
        quality_rule_api_client,
        settings_api_client,
        page,
        SimpleNamespace(),
    )
    manager.show_toast = Mock()
    return manager


def build_custom_prompt_page() -> tuple[CustomPromptPage, dict[str, object]]:
    page = CustomPromptPage.__new__(CustomPromptPage)
    page.task_type = CustomPromptPage.TASK_TYPE_TRANSLATION
    page.prompt_revision = 7
    page.prompt_enabled = False
    page.default_prompt_text = "默认提示词"
    page.quality_rule_api_client = Mock()
    page.settings_api_client = Mock()

    state: dict[str, object] = {
        "text": "旧提示词",
        "checked": False,
        "toasts": [],
    }

    def set_editor_prompt_text(text: str) -> None:
        state["text"] = text

    def set_prompt_switch_checked(enabled: bool) -> None:
        state["checked"] = enabled

    def emit_toast(toast_type: Base.ToastType, message: str) -> None:
        state["toasts"].append((toast_type, message))

    def apply_prompt_snapshot(snapshot: dict[str, object]) -> None:
        page.prompt_revision = int(snapshot.get("revision", 0) or 0)
        meta = snapshot.get("meta", {})
        if isinstance(meta, dict):
            page.prompt_enabled = bool(meta.get("enabled", False))
        else:
            page.prompt_enabled = False

    page.get_editor_prompt_data = lambda: str(state["text"])
    page.get_current_prompt_enabled = lambda: bool(state["checked"])
    page.set_editor_prompt_text = set_editor_prompt_text
    page.set_prompt_switch_checked = set_prompt_switch_checked
    page.emit_toast = emit_toast
    page.apply_prompt_snapshot = apply_prompt_snapshot
    return page, state


def test_custom_prompt_page_reload_prompt_template_updates_setting_card_description() -> (
    None
):
    page = CustomPromptPage.__new__(CustomPromptPage)
    page.task_type = CustomPromptPage.TASK_TYPE_TRANSLATION
    page.quality_rule_api_client = Mock()
    page.quality_rule_api_client.get_prompt_template.return_value = {
        "default_text": "默认提示词",
        "prefix_text": "前缀提示词",
        "suffix_text": "后缀\n提示词",
    }
    page.prefix_body = Mock(spec=SettingCard)
    page.suffix_body = Mock(spec=SettingCard)

    page.reload_prompt_template()

    page.prefix_body.set_description.assert_called_once_with("前缀提示词")
    page.suffix_body.set_description.assert_called_once_with("后缀提示词")


def test_quality_rule_preset_manager_save_preset_detects_casefold_duplicate(
    monkeypatch,
) -> None:
    manager = build_quality_rule_preset_manager()
    manager.quality_rule_api_client.list_rule_presets.return_value = (
        [],
        [{"virtual_id": "user:demo.json"}],
    )
    monkeypatch.setattr(preset_manager_module, "MessageBox", RejectingMessageBox)

    result = manager.save_preset("Demo")

    assert result is False
    manager.quality_rule_api_client.save_rule_preset.assert_not_called()


def test_quality_rule_preset_manager_rename_preset_detects_casefold_duplicate() -> None:
    manager = build_quality_rule_preset_manager()
    manager.quality_rule_api_client.list_rule_presets.return_value = (
        [],
        [
            {"virtual_id": "user:demo.json"},
            {"virtual_id": "user:mine.json"},
        ],
    )

    result = manager.rename_preset(
        {"virtual_id": "user:mine.json", "name": "mine"},
        "Demo",
    )

    assert result is False
    manager.quality_rule_api_client.rename_rule_preset.assert_not_called()
    manager.show_toast.assert_called_once()
    toast_type, _message = manager.show_toast.call_args.args
    assert toast_type == Base.ToastType.WARNING


def test_custom_prompt_page_save_prompt_preset_detects_casefold_duplicate(
    monkeypatch,
) -> None:
    page, _state = build_custom_prompt_page()
    page.quality_rule_api_client.list_prompt_presets.return_value = (
        [],
        [{"virtual_id": "user:demo.txt"}],
    )
    AutoSubmitLineEditMessageBox.submitted_text = "Demo"
    monkeypatch.setattr(
        custom_prompt_page_module,
        "LineEditMessageBox",
        AutoSubmitLineEditMessageBox,
    )
    monkeypatch.setattr(custom_prompt_page_module, "MessageBox", RejectingMessageBox)

    page.save_prompt_preset(SimpleNamespace())

    page.quality_rule_api_client.save_prompt_preset.assert_not_called()


def test_custom_prompt_page_rename_prompt_preset_detects_casefold_duplicate(
    monkeypatch,
) -> None:
    page, state = build_custom_prompt_page()
    page.quality_rule_api_client.list_prompt_presets.return_value = (
        [],
        [
            {"virtual_id": "user:demo.txt"},
            {"virtual_id": "user:mine.txt"},
        ],
    )
    AutoSubmitLineEditMessageBox.submitted_text = "Demo"
    monkeypatch.setattr(
        custom_prompt_page_module,
        "LineEditMessageBox",
        AutoSubmitLineEditMessageBox,
    )

    page.rename_prompt_preset(
        SimpleNamespace(),
        {"virtual_id": "user:mine.txt", "name": "mine"},
    )

    page.quality_rule_api_client.rename_prompt_preset.assert_not_called()
    assert state["toasts"]
    toast_type, _message = state["toasts"][-1]
    assert toast_type == Base.ToastType.WARNING


def test_custom_prompt_page_save_prompt_rolls_back_ui_when_save_fails() -> None:
    page, state = build_custom_prompt_page()
    state["checked"] = True
    page.quality_rule_api_client.save_prompt.side_effect = RuntimeError("revision")

    result = page.save_prompt(
        enabled=True,
        rollback_text="旧提示词",
        rollback_enabled=False,
    )

    assert result is None
    assert state["text"] == "旧提示词"
    assert state["checked"] is False
    assert state["toasts"]
    toast_type, _message = state["toasts"][-1]
    assert toast_type == Base.ToastType.ERROR


def test_custom_prompt_page_apply_prompt_preset_rolls_back_ui_when_save_fails() -> None:
    page, state = build_custom_prompt_page()
    page.quality_rule_api_client.read_prompt_preset.return_value = "预设提示词"
    page.quality_rule_api_client.save_prompt.side_effect = RuntimeError("revision")

    page.apply_prompt_preset({"virtual_id": "user:demo.txt"})

    assert state["text"] == "旧提示词"
    assert state["checked"] is False
    assert state["toasts"]
    toast_type, _message = state["toasts"][-1]
    assert toast_type == Base.ToastType.ERROR
