from functools import partial

from PySide6.QtCore import QPoint
from PySide6.QtWidgets import QFileDialog
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CommandButton
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import SwitchButton

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.CustomTextEdit import CustomTextEdit
from widget.LineEditMessageBox import LineEditMessageBox
from widget.SettingCard import SettingCard

# ==================== 图标常量 ====================

ICON_ACTION_SAVE: BaseIcon = BaseIcon.SAVE  # 命令栏：保存当前提示词
ICON_ACTION_IMPORT: BaseIcon = BaseIcon.FILE_DOWN  # 命令栏：导入
ICON_ACTION_EXPORT: BaseIcon = BaseIcon.FILE_UP  # 命令栏：导出
ICON_PRESET_MENU_ROOT: BaseIcon = BaseIcon.FOLDER_OPEN  # 命令栏：预设菜单入口

ICON_PRESET_RESET: BaseIcon = BaseIcon.RECYCLE  # 预设菜单：重置为当前 UI 模板
ICON_PRESET_SAVE_PRESET: BaseIcon = BaseIcon.SAVE  # 预设菜单：保存为预设
ICON_PRESET_FOLDER: BaseIcon = BaseIcon.FOLDER  # 预设子菜单：目录/分组
ICON_PRESET_IMPORT: BaseIcon = BaseIcon.FILE_DOWN  # 预设子菜单：导入/应用

ICON_PRESET_DEFAULT_MARK: BaseIcon = BaseIcon.FOLDER_HEART  # 子菜单：当前为默认预设
ICON_PRESET_SET_DEFAULT: BaseIcon = BaseIcon.HEART  # 子菜单动作：设为默认预设
ICON_PRESET_CANCEL_DEFAULT: BaseIcon = BaseIcon.HEART_OFF  # 子菜单动作：取消默认预设

ICON_PRESET_RENAME: BaseIcon = BaseIcon.PENCIL_LINE  # 子菜单动作：重命名
ICON_PRESET_DELETE: BaseIcon = BaseIcon.TRASH_2  # 子菜单动作：删除


class CustomPromptPage(Base, QWidget):
    """自定义提示词页。"""

    TASK_TYPE_TRANSLATION: str = "translation"
    TASK_TYPE_ANALYSIS: str = "analysis"
    USER_PRESET_PREFIX: str = "user:"
    PRESET_EXTENSION: str = ".txt"

    def __init__(
        self,
        text: str,
        window: FluentWindow,
        task_type: str,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        self.task_type: str = str(task_type)
        self.quality_rule_api_client = window.quality_rule_api_client
        self.settings_api_client = window.settings_api_client
        self.api_state_store = window.api_state_store
        self.prompt_revision: int = 0
        self.prompt_enabled: bool = False
        self.default_prompt_text: str = ""
        self.prefix_prompt_text: str = ""
        self.suffix_prompt_text: str = ""

        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        self.add_widget_header(self.root)
        self.add_widget_body(self.root)
        self.add_widget_footer(self.root, window)
        self.reload_prompt_template()

        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

        if self.api_state_store.is_project_loaded():
            self.reload_prompt_snapshot()

    def is_translation_task(self) -> bool:
        return self.task_type == self.TASK_TYPE_TRANSLATION

    def get_default_preset_config_key(self) -> str:
        if self.is_translation_task():
            return "translation_custom_prompt_default_preset"
        return "analysis_custom_prompt_default_preset"

    def get_page_key_prefix(self) -> str:
        if self.is_translation_task():
            return "translation_prompt"
        return "analysis_prompt"

    def build_user_preset_virtual_id(self, name: str) -> str:
        return f"{self.USER_PRESET_PREFIX}{name}{self.PRESET_EXTENSION}"

    def has_casefold_duplicate(
        self,
        existing_virtual_ids: set[str],
        target_virtual_id: str,
    ) -> bool:
        """Windows 等大小写不敏感文件系统上，必须按 casefold 判断同名冲突。"""

        target_key = target_virtual_id.casefold()
        return target_key in {value.casefold() for value in existing_virtual_ids}

    def get_editor_prompt_data(self) -> str:
        """统一收口编辑框当前正文，避免多个保存入口写入口径漂移。"""

        return self.main_text.toPlainText().strip()

    def get_current_prompt_enabled(self) -> bool:
        return bool(self.prompt_switch.isChecked())

    def emit_toast(self, toast_type: Base.ToastType, message: str) -> None:
        self.emit(
            Base.Event.TOAST,
            {
                "type": toast_type,
                "message": message,
            },
        )

    def set_prompt_switch_checked(self, enabled: bool) -> None:
        self.prompt_switch.blockSignals(True)
        self.prompt_switch.setChecked(bool(enabled))
        self.prompt_switch.blockSignals(False)

    def apply_prompt_snapshot(self, snapshot: dict[str, object]) -> None:
        self.prompt_revision = int(snapshot.get("revision", 0) or 0)
        meta_raw = snapshot.get("meta", {})
        if isinstance(meta_raw, dict):
            self.prompt_enabled = bool(meta_raw.get("enabled", False))
        else:
            self.prompt_enabled = False

    def set_editor_prompt_text(self, text: str) -> None:
        self.main_text.setPlainText(text)

    def reload_prompt_template(self) -> None:
        template = self.quality_rule_api_client.get_prompt_template(self.task_type)
        self.default_prompt_text = str(template.get("default_text", ""))
        self.prefix_prompt_text = str(template.get("prefix_text", ""))
        self.suffix_prompt_text = str(template.get("suffix_text", ""))
        # SettingCard 统一通过描述接口刷新正文，避免沿用旧卡片 API 导致启动崩溃。
        self.prefix_body.set_description(self.prefix_prompt_text)
        self.suffix_body.set_description(self.suffix_prompt_text.replace("\n", ""))

    def reload_prompt_snapshot(self) -> None:
        if not self.api_state_store.is_project_loaded():
            return

        snapshot = self.quality_rule_api_client.get_prompt_snapshot(self.task_type)
        self.apply_prompt_snapshot(snapshot)
        prompt_text = str(snapshot.get("text", ""))
        if prompt_text == "":
            prompt_text = self.default_prompt_text
        self.set_editor_prompt_text(prompt_text)
        self.set_prompt_switch_checked(self.prompt_enabled)

    def save_prompt(
        self,
        *,
        enabled: bool | None = None,
        rollback_text: str | None = None,
        rollback_enabled: bool | None = None,
    ) -> dict[str, object] | None:
        if rollback_text is None:
            rollback_text = self.get_editor_prompt_data()
        if rollback_enabled is None:
            rollback_enabled = self.get_current_prompt_enabled()

        request: dict[str, object] = {
            "task_type": self.task_type,
            "expected_revision": self.prompt_revision,
            "text": self.get_editor_prompt_data(),
        }
        if enabled is not None:
            request["enabled"] = bool(enabled)

        try:
            snapshot = self.quality_rule_api_client.save_prompt(request)
        except Exception as e:
            LogManager.get().error(f"保存自定义提示词失败 - task={self.task_type}", e)
            self.set_editor_prompt_text(rollback_text)
            self.set_prompt_switch_checked(rollback_enabled)
            self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
            return None

        self.apply_prompt_snapshot(snapshot)
        prompt_text = str(snapshot.get("text", ""))
        if prompt_text == "":
            prompt_text = self.default_prompt_text
        self.set_editor_prompt_text(prompt_text)
        self.set_prompt_switch_checked(self.prompt_enabled)
        return snapshot

    def import_prompt_from_path(self, path: str) -> None:
        try:
            snapshot = self.quality_rule_api_client.import_prompt(
                {
                    "task_type": self.task_type,
                    "path": path,
                    "expected_revision": self.prompt_revision,
                }
            )
        except Exception as e:
            LogManager.get().error(f"导入自定义提示词失败 - {path}", e)
            self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
            return

        self.apply_prompt_snapshot(snapshot)
        self.set_editor_prompt_text(str(snapshot.get("text", "")))
        self.set_prompt_switch_checked(self.prompt_enabled)
        self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().quality_import_toast)

    def export_prompt_to_path(self, path: str) -> None:
        try:
            self.quality_rule_api_client.export_prompt(
                {
                    "task_type": self.task_type,
                    "path": path,
                }
            )
        except Exception as e:
            LogManager.get().error(f"导出自定义提示词失败 - {path}", e)
            self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
            return

        self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().quality_export_toast)

    def get_default_preset_virtual_id(self) -> str:
        settings_snapshot = self.settings_api_client.get_app_settings()
        value = getattr(settings_snapshot, self.get_default_preset_config_key(), "")
        return str(value)

    def set_default_preset(self, item: dict[str, str]) -> None:
        self.settings_api_client.update_app_settings(
            {
                self.get_default_preset_config_key(): item["virtual_id"],
            }
        )
        self.emit_toast(
            Base.ToastType.SUCCESS,
            Localizer.get().quality_set_default_preset_success,
        )

    def cancel_default_preset(self) -> None:
        self.settings_api_client.update_app_settings(
            {
                self.get_default_preset_config_key(): "",
            }
        )
        self.emit_toast(
            Base.ToastType.SUCCESS,
            Localizer.get().quality_cancel_default_preset_success,
        )

    def reset_prompt_to_template(self, window: FluentWindow) -> None:
        message_box = MessageBox(
            Localizer.get().alert,
            Localizer.get().alert_confirm_reset_data,
            window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        previous_text = self.get_editor_prompt_data()
        previous_enabled = self.get_current_prompt_enabled()
        self.set_editor_prompt_text(self.default_prompt_text)
        snapshot = self.save_prompt(
            rollback_text=previous_text,
            rollback_enabled=previous_enabled,
        )
        if snapshot is None:
            return
        self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().toast_reset)

    def apply_prompt_preset(self, item: dict[str, str]) -> None:
        try:
            text = self.quality_rule_api_client.read_prompt_preset(
                self.task_type,
                item["virtual_id"],
            )
        except Exception as e:
            LogManager.get().error(f"应用预设失败 - {item['virtual_id']}", e)
            self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
            return

        previous_text = self.get_editor_prompt_data()
        previous_enabled = self.get_current_prompt_enabled()
        self.set_editor_prompt_text(text)
        snapshot = self.save_prompt(
            rollback_text=previous_text,
            rollback_enabled=previous_enabled,
        )
        if snapshot is None:
            return

        self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().quality_import_toast)

    def save_prompt_preset(self, window: FluentWindow) -> None:
        builtin_presets, user_presets = (
            self.quality_rule_api_client.list_prompt_presets(self.task_type)
        )
        del builtin_presets
        existing_virtual_ids = {item.get("virtual_id", "") for item in user_presets}

        def on_save(dialog: LineEditMessageBox, text: str) -> None:
            normalized_name = text.strip()
            if normalized_name == "":
                return

            target_virtual_id = self.build_user_preset_virtual_id(normalized_name)
            if self.has_casefold_duplicate(existing_virtual_ids, target_virtual_id):
                message_box = MessageBox(
                    Localizer.get().warning,
                    Localizer.get().alert_preset_already_exists,
                    window,
                )
                message_box.yesButton.setText(Localizer.get().confirm)
                message_box.cancelButton.setText(Localizer.get().cancel)
                if not message_box.exec():
                    return

            try:
                self.quality_rule_api_client.save_prompt_preset(
                    self.task_type,
                    normalized_name,
                    self.get_editor_prompt_data(),
                )
            except Exception as e:
                LogManager.get().error(
                    (
                        "保存自定义提示词预设失败: "
                        f"task={self.task_type} name={normalized_name}"
                    ),
                    e,
                )
                self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
                return

            self.emit_toast(
                Base.ToastType.SUCCESS,
                Localizer.get().quality_save_preset_success,
            )
            dialog.accept()

        dialog = LineEditMessageBox(
            window,
            Localizer.get().quality_save_preset_title,
            on_save,
        )
        dialog.exec()

    def rename_prompt_preset(self, window: FluentWindow, item: dict[str, str]) -> None:
        _builtin_presets, user_presets = (
            self.quality_rule_api_client.list_prompt_presets(self.task_type)
        )
        existing_virtual_ids = {
            preset.get("virtual_id", "")
            for preset in user_presets
            if preset.get("virtual_id", "") != item.get("virtual_id", "")
        }

        def on_rename(dialog: LineEditMessageBox, text: str) -> None:
            normalized_name = text.strip()
            if normalized_name == "":
                return

            new_virtual_id = self.build_user_preset_virtual_id(normalized_name)
            if self.has_casefold_duplicate(existing_virtual_ids, new_virtual_id):
                self.emit_toast(
                    Base.ToastType.WARNING,
                    Localizer.get().alert_file_already_exists,
                )
                return

            try:
                renamed_item = self.quality_rule_api_client.rename_prompt_preset(
                    self.task_type,
                    item["virtual_id"],
                    normalized_name,
                )
                if self.get_default_preset_virtual_id() == item["virtual_id"]:
                    self.settings_api_client.update_app_settings(
                        {
                            self.get_default_preset_config_key(): renamed_item.get(
                                "virtual_id", ""
                            ),
                        }
                    )
            except Exception as e:
                LogManager.get().error(
                    f"重命名预设失败: {item['virtual_id']} -> {new_virtual_id}",
                    e,
                )
                self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
                return

            self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().task_success)
            dialog.accept()

        dialog = LineEditMessageBox(window, Localizer.get().rename, on_rename)
        dialog.get_line_edit().setText(item["name"])
        dialog.exec()

    def delete_prompt_preset(self, window: FluentWindow, item: dict[str, str]) -> None:
        message_box = MessageBox(
            Localizer.get().warning,
            Localizer.get().alert_confirm_delete_data,
            window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        try:
            self.quality_rule_api_client.delete_prompt_preset(
                self.task_type,
                item["virtual_id"],
            )
            if self.get_default_preset_virtual_id() == item["virtual_id"]:
                self.settings_api_client.update_app_settings(
                    {
                        self.get_default_preset_config_key(): "",
                    }
                )
        except Exception as e:
            LogManager.get().error(f"删除预设失败: {item['virtual_id']}", e)
            self.emit_toast(Base.ToastType.ERROR, Localizer.get().task_failed)
            return

        self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().task_success)

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.reload_prompt_template()
        self.reload_prompt_snapshot()

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.prompt_revision = 0
        self.prompt_enabled = False
        self.main_text.clear()
        self.set_prompt_switch_checked(False)

    def add_widget_header(self, parent: QLayout) -> None:
        base_key = self.get_page_key_prefix()

        def checked_changed(button: SwitchButton) -> None:
            self.save_prompt(
                enabled=button.isChecked(),
                rollback_text=self.get_editor_prompt_data(),
                rollback_enabled=self.prompt_enabled,
            )

        card = SettingCard(
            title=getattr(Localizer.get(), f"{base_key}_page_head"),
            description=getattr(Localizer.get(), f"{base_key}_page_head_desc"),
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(False)
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        self.prompt_switch = switch_button
        parent.addWidget(card)

    def add_widget_body(self, parent: QLayout) -> None:
        self.prefix_body = SettingCard("", "", parent=self)
        parent.addWidget(self.prefix_body)

        self.main_text = CustomTextEdit(self)
        self.main_text.setPlainText("")
        parent.addWidget(self.main_text)

        self.suffix_body = SettingCard("", "", parent=self)
        parent.addWidget(self.suffix_body)

    def add_widget_footer(self, parent: QLayout, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.add_command_bar_action_import(self.command_bar_card)
        self.add_command_bar_action_export(self.command_bar_card, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_save(self.command_bar_card)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(self.command_bar_card, window)

    def add_command_bar_action_import(self, parent: CommandBarCard) -> None:
        def triggered(checked: bool = False) -> None:
            del checked
            path, _ = QFileDialog.getOpenFileName(
                None,
                Localizer.get().select_file,
                "",
                Localizer.get().custom_prompt_select_file_type,
            )
            if not isinstance(path, str) or path == "":
                return
            self.import_prompt_from_path(path)

        parent.add_action(
            Action(
                ICON_ACTION_IMPORT,
                Localizer.get().quality_import,
                parent,
                triggered=triggered,
            ),
        )

    def add_command_bar_action_export(
        self,
        parent: CommandBarCard,
        window: FluentWindow,
    ) -> None:
        def triggered(checked: bool = False) -> None:
            del checked
            path, _ = QFileDialog.getSaveFileName(
                window,
                Localizer.get().select_file,
                "",
                Localizer.get().custom_prompt_select_file_type,
            )
            if not isinstance(path, str) or path == "":
                return
            self.export_prompt_to_path(path)

        parent.add_action(
            Action(
                ICON_ACTION_EXPORT,
                Localizer.get().quality_export,
                parent,
                triggered=triggered,
            ),
        )

    def add_command_bar_action_save(self, parent: CommandBarCard) -> None:
        def triggered(checked: bool = False) -> None:
            del checked
            snapshot = self.save_prompt()
            if snapshot is None:
                return
            self.emit_toast(Base.ToastType.SUCCESS, Localizer.get().toast_save)

        parent.add_action(
            Action(
                ICON_ACTION_SAVE,
                Localizer.get().save,
                parent,
                triggered=triggered,
            ),
        )

    def add_command_bar_action_preset(
        self,
        parent: CommandBarCard,
        window: FluentWindow,
    ) -> None:
        widget: CommandButton | None = None

        def triggered(checked: bool = False) -> None:
            del checked
            if widget is None:
                return

            menu = RoundMenu("", widget)
            builtin_presets, user_presets = (
                self.quality_rule_api_client.list_prompt_presets(self.task_type)
            )
            default_preset_virtual_id = self.get_default_preset_virtual_id()

            menu.addAction(
                Action(
                    ICON_PRESET_RESET,
                    Localizer.get().reset,
                    triggered=lambda: self.reset_prompt_to_template(window),
                )
            )
            menu.addAction(
                Action(
                    ICON_PRESET_SAVE_PRESET,
                    Localizer.get().quality_save_preset,
                    triggered=lambda: self.save_prompt_preset(window),
                )
            )

            if builtin_presets or user_presets:
                menu.addSeparator()

            for item in builtin_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(ICON_PRESET_FOLDER)
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_IMPORT,
                        Localizer.get().quality_import,
                        triggered=partial(self.apply_prompt_preset, item),
                    )
                )
                sub_menu.addSeparator()

                if default_preset_virtual_id == item["virtual_id"]:
                    sub_menu.setIcon(ICON_PRESET_DEFAULT_MARK)
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_CANCEL_DEFAULT,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=self.cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_SET_DEFAULT,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(self.set_default_preset, item),
                        )
                    )

                menu.addMenu(sub_menu)

            if builtin_presets and user_presets:
                menu.addSeparator()

            for item in user_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(ICON_PRESET_FOLDER)
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_IMPORT,
                        Localizer.get().quality_import,
                        triggered=partial(self.apply_prompt_preset, item),
                    )
                )
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_RENAME,
                        Localizer.get().rename,
                        triggered=partial(self.rename_prompt_preset, window, item),
                    )
                )
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_DELETE,
                        Localizer.get().quality_delete_preset,
                        triggered=partial(self.delete_prompt_preset, window, item),
                    )
                )
                sub_menu.addSeparator()

                if default_preset_virtual_id == item["virtual_id"]:
                    sub_menu.setIcon(ICON_PRESET_DEFAULT_MARK)
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_CANCEL_DEFAULT,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=self.cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_SET_DEFAULT,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(self.set_default_preset, item),
                        )
                    )

                menu.addMenu(sub_menu)

            global_pos = widget.mapToGlobal(QPoint(0, 0))
            menu.exec(global_pos, ani=True, aniType=MenuAnimationType.PULL_UP)

        widget = parent.add_action(
            Action(
                ICON_PRESET_MENU_ROOT,
                Localizer.get().quality_preset,
                parent=parent,
                triggered=triggered,
            )
        )
