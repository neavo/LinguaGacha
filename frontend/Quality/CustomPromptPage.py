import os
from functools import partial
from pathlib import Path

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
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from module.PromptPathResolver import PromptPathResolver
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
    """自定义提示词页。

    为什么改成 task_type：
    - 页面语义已经从“中文/英文”切到“翻译/分析”
    - 运行时模板语言由当前 UI 语言统一决定，页面自身不再持有语言分支
    """

    def __init__(
        self,
        text: str,
        window: FluentWindow,
        task_type: PromptPathResolver.TaskType,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        self.task_type = task_type

        config = Config().load()

        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        self.add_widget_header(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_footer(self.root, config, window)

        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

    def is_translation_task(self) -> bool:
        return self.task_type == PromptPathResolver.TaskType.TRANSLATION

    def get_prompt_data(self) -> str:
        if self.is_translation_task():
            return DataManager.get().get_translation_prompt()
        return DataManager.get().get_analysis_prompt()

    def set_prompt_data(self, data: str) -> None:
        if self.is_translation_task():
            DataManager.get().set_translation_prompt(data)
        else:
            DataManager.get().set_analysis_prompt(data)

    def get_prompt_enable(self) -> bool:
        if self.is_translation_task():
            return DataManager.get().get_translation_prompt_enable()
        return DataManager.get().get_analysis_prompt_enable()

    def set_prompt_enable(self, enable: bool) -> None:
        if self.is_translation_task():
            DataManager.get().set_translation_prompt_enable(enable)
        else:
            DataManager.get().set_analysis_prompt_enable(enable)

    def get_editor_prompt_data(self) -> str:
        """统一收口编辑框当前正文，避免保存入口之间写入规则漂移。"""
        return self.main_text.toPlainText().strip()

    def persist_editor_prompt_data(self) -> str:
        """先把当前编辑内容落库，再由其它入口决定是否更新开关或提示。"""
        prompt_data = self.get_editor_prompt_data()
        if not DataManager.get().is_loaded():
            return prompt_data
        self.set_prompt_data(prompt_data)
        return prompt_data

    def persist_editor_prompt_data_and_enable(self, enable: bool) -> None:
        """切换开关时先保存正文，确保启用后立刻读取到最新规则。"""
        self.persist_editor_prompt_data()
        self.set_prompt_enable(enable)

    def get_default_preset_config_key(self) -> str:
        if self.is_translation_task():
            return "translation_custom_prompt_default_preset"
        return "analysis_custom_prompt_default_preset"

    def get_page_key_prefix(self) -> str:
        if self.is_translation_task():
            return "translation_prompt"
        return "analysis_prompt"

    def build_default_prompt_text(self, config: Config) -> str:
        builder = PromptBuilder(config)
        language = builder.get_prompt_ui_language()
        if self.is_translation_task():
            return builder.get_base(language)
        return builder.get_analysis_base(language)

    def build_prefix_text(self, config: Config) -> str:
        builder = PromptBuilder(config)
        language = builder.get_prompt_ui_language()
        if self.is_translation_task():
            return builder.get_prefix(language)
        return builder.get_analysis_prefix(language)

    def build_suffix_text(self, config: Config) -> str:
        builder = PromptBuilder(config)
        language = builder.get_prompt_ui_language()
        if self.is_translation_task():
            return builder.get_suffix(language)
        return builder.get_analysis_suffix(language)

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        prompt_data = self.get_prompt_data()
        if not prompt_data:
            prompt_data = self.build_default_prompt_text(Config().load())

        self.main_text.setPlainText(prompt_data)
        if hasattr(self, "prompt_switch") and self.prompt_switch is not None:
            self.prompt_switch.setChecked(self.get_prompt_enable())

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        self.main_text.clear()
        if hasattr(self, "prompt_switch") and self.prompt_switch is not None:
            self.prompt_switch.setChecked(False)

    def add_widget_header(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        del config
        del window

        base_key = self.get_page_key_prefix()

        def checked_changed(button: SwitchButton) -> None:
            self.persist_editor_prompt_data_and_enable(button.isChecked())

        card = SettingCard(
            title=getattr(Localizer.get(), f"{base_key}_page_head"),
            description=getattr(Localizer.get(), f"{base_key}_page_head_desc"),
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(self.get_prompt_enable())
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        self.prompt_switch = switch_button
        parent.addWidget(card)

    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        del window

        self.prefix_body = SettingCard("", self.build_prefix_text(config), parent=self)
        parent.addWidget(self.prefix_body)

        self.main_text = CustomTextEdit(self)
        self.main_text.setPlainText("")
        parent.addWidget(self.main_text)

        self.suffix_body = SettingCard(
            "",
            self.build_suffix_text(config).replace("\n", ""),
            parent=self,
        )
        parent.addWidget(self.suffix_body)

    def add_widget_footer(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.add_command_bar_action_import(self.command_bar_card, config, window)
        self.add_command_bar_action_export(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_save(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(self.command_bar_card, config, window)

    def import_prompt_from_path(self, path: str) -> None:
        try:
            with open(path, "r", encoding="utf-8-sig") as reader:
                text = reader.read().strip()
        except Exception as e:
            LogManager.get().error(f"Failed to import custom prompt - {path}", e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            return

        self.set_prompt_data(text)
        self.main_text.setPlainText(text)

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            },
        )

    def export_prompt_to_path(self, path: str) -> None:
        try:
            final_path = Path(path)
            if final_path.suffix.lower() != ".txt":
                final_path = final_path.with_suffix(".txt")
            with open(str(final_path), "w", encoding="utf-8") as writer:
                writer.write(self.main_text.toPlainText().strip())
        except Exception as e:
            LogManager.get().error(f"Failed to export custom prompt - {path}", e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            return

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_export_toast,
            },
        )

    def add_command_bar_action_import(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        del config
        del window

        def triggered(checked: bool = False) -> None:
            del checked
            path, _ = QFileDialog.getOpenFileName(
                None,
                Localizer.get().select_file,
                "",
                Localizer.get().custom_prompt_select_file_type,
            )
            if not isinstance(path, str) or not path:
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
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        del config

        def triggered(checked: bool = False) -> None:
            del checked
            path, _ = QFileDialog.getSaveFileName(
                window,
                Localizer.get().select_file,
                "",
                Localizer.get().custom_prompt_select_file_type,
            )
            if not isinstance(path, str) or not path:
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

    def add_command_bar_action_save(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        del config
        del window

        def triggered(checked: bool = False) -> None:
            del checked
            self.persist_editor_prompt_data()
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().toast_save,
                },
            )

        parent.add_action(
            Action(
                ICON_ACTION_SAVE,
                Localizer.get().save,
                parent,
                triggered=triggered,
            ),
        )

    def add_command_bar_action_preset(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        widget: CommandButton = None

        def get_preset_paths() -> tuple[list[dict[str, str]], list[dict[str, str]]]:
            return PromptPathResolver.list_presets(self.task_type)

        def set_default_preset(item: dict[str, str], checked: bool = False) -> None:
            del checked
            key = self.get_default_preset_config_key()
            current_config = Config().load()
            setattr(current_config, key, item["virtual_id"])
            current_config.save()
            setattr(config, key, item["virtual_id"])

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_set_default_preset_success,
                },
            )

        def cancel_default_preset(checked: bool = False) -> None:
            del checked
            key = self.get_default_preset_config_key()
            current_config = Config().load()
            setattr(current_config, key, "")
            current_config.save()
            setattr(config, key, "")

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_cancel_default_preset_success,
                },
            )

        def reset(checked: bool = False) -> None:
            del checked
            message_box = MessageBox(
                Localizer.get().alert, Localizer.get().alert_confirm_reset_data, window
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            default_prompt = self.build_default_prompt_text(Config().load())
            self.set_prompt_data(default_prompt)
            self.main_text.setPlainText(default_prompt)

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().toast_reset,
                },
            )

        def apply_preset(item: dict[str, str], checked: bool = False) -> None:
            del checked
            try:
                prompt = PromptPathResolver.read_preset(
                    self.task_type, item["virtual_id"]
                )
            except Exception as e:
                LogManager.get().error(
                    f"Failed to apply preset - {item['virtual_id']}", e
                )
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )
                return

            self.set_prompt_data(prompt)
            self.main_text.setPlainText(prompt)

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_import_toast,
                },
            )

        def save_preset(checked: bool = False) -> None:
            del checked

            def on_save(dialog: LineEditMessageBox, text: str) -> None:
                normalized_name = text.strip()
                if not normalized_name:
                    return

                target_virtual_id = PromptPathResolver.build_virtual_id(
                    PromptPathResolver.PresetSource.USER,
                    f"{normalized_name}.txt",
                )
                target_path = PromptPathResolver.resolve_virtual_id_path(
                    self.task_type, target_virtual_id
                )
                if os.path.exists(target_path):
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
                    PromptPathResolver.save_user_preset(
                        self.task_type,
                        normalized_name,
                        self.main_text.toPlainText(),
                    )
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().quality_save_preset_success,
                        },
                    )
                    dialog.accept()
                except Exception as e:
                    LogManager.get().error(
                        f"Failed to save custom prompt preset: task={self.task_type.value} name={normalized_name}",
                        e,
                    )
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.ERROR,
                            "message": Localizer.get().task_failed,
                        },
                    )

            dialog = LineEditMessageBox(
                window, Localizer.get().quality_save_preset_title, on_save
            )
            dialog.exec()

        def rename_preset(item: dict[str, str], checked: bool = False) -> None:
            del checked

            def on_rename(dialog: LineEditMessageBox, text: str) -> None:
                normalized_name = text.strip()
                if not normalized_name:
                    return

                new_virtual_id = PromptPathResolver.build_virtual_id(
                    PromptPathResolver.PresetSource.USER,
                    f"{normalized_name}.txt",
                )
                new_path = PromptPathResolver.resolve_virtual_id_path(
                    self.task_type, new_virtual_id
                )
                if os.path.exists(new_path):
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().alert_file_already_exists,
                        },
                    )
                    return

                try:
                    renamed_item = PromptPathResolver.rename_user_preset(
                        self.task_type, item["virtual_id"], normalized_name
                    )
                    current_default = getattr(
                        Config().load(),
                        self.get_default_preset_config_key(),
                        "",
                    )
                    if current_default == item["virtual_id"]:
                        current_config = Config().load()
                        setattr(
                            current_config,
                            self.get_default_preset_config_key(),
                            renamed_item["virtual_id"],
                        )
                        current_config.save()
                        setattr(
                            config,
                            self.get_default_preset_config_key(),
                            renamed_item["virtual_id"],
                        )

                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().task_success,
                        },
                    )
                    dialog.accept()
                except Exception as e:
                    LogManager.get().error(
                        f"Failed to rename preset: {item['virtual_id']} -> {new_virtual_id}",
                        e,
                    )
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.ERROR,
                            "message": Localizer.get().task_failed,
                        },
                    )

            dialog = LineEditMessageBox(window, Localizer.get().rename, on_rename)
            dialog.get_line_edit().setText(item["name"])
            dialog.exec()

        def delete_preset(item: dict[str, str], checked: bool = False) -> None:
            del checked
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
                PromptPathResolver.delete_user_preset(
                    self.task_type, item["virtual_id"]
                )

                key = self.get_default_preset_config_key()
                current_config = Config().load()
                if getattr(current_config, key, "") == item["virtual_id"]:
                    setattr(current_config, key, "")
                    current_config.save()
                    setattr(config, key, "")

                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().task_success,
                    },
                )
            except Exception as e:
                LogManager.get().error(
                    f"Failed to delete preset: {item['virtual_id']}", e
                )
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().task_failed,
                    },
                )

        def triggered(checked: bool = False) -> None:
            del checked
            menu = RoundMenu("", widget)

            menu.addAction(
                Action(
                    ICON_PRESET_RESET,
                    Localizer.get().reset,
                    triggered=reset,
                )
            )
            menu.addAction(
                Action(
                    ICON_PRESET_SAVE_PRESET,
                    Localizer.get().quality_save_preset,
                    triggered=save_preset,
                )
            )
            builtin_presets, user_presets = get_preset_paths()
            key = self.get_default_preset_config_key()

            if builtin_presets or user_presets:
                # 只有后面真有预设分组时，才需要把固定动作和预设列表隔开。
                menu.addSeparator()

            for item in builtin_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(ICON_PRESET_FOLDER)
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_IMPORT,
                        Localizer.get().quality_import,
                        triggered=partial(apply_preset, item),
                    )
                )
                sub_menu.addSeparator()

                if getattr(config, key, "") == item["virtual_id"]:
                    sub_menu.setIcon(ICON_PRESET_DEFAULT_MARK)
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_CANCEL_DEFAULT,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_SET_DEFAULT,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(set_default_preset, item),
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
                        triggered=partial(apply_preset, item),
                    )
                )
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_RENAME,
                        Localizer.get().rename,
                        triggered=partial(rename_preset, item),
                    )
                )
                sub_menu.addAction(
                    Action(
                        ICON_PRESET_DELETE,
                        Localizer.get().quality_delete_preset,
                        triggered=partial(delete_preset, item),
                    )
                )
                sub_menu.addSeparator()

                if getattr(config, key, "") == item["virtual_id"]:
                    sub_menu.setIcon(ICON_PRESET_DEFAULT_MARK)
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_CANCEL_DEFAULT,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            ICON_PRESET_SET_DEFAULT,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(set_default_preset, item),
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
