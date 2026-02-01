import os
from functools import partial

from PyQt5.QtCore import QPoint
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CommandButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.PromptBuilder import PromptBuilder
from widget.CommandBarCard import CommandBarCard
from widget.CustomTextEdit import CustomTextEdit
from widget.EmptyCard import EmptyCard
from widget.LineEditMessageBox import LineEditMessageBox
from widget.SwitchButtonCard import SwitchButtonCard


class CustomPromptPage(QWidget, Base):
    def __init__(
        self, text: str, window: FluentWindow, language: BaseLanguage.Enum
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        self.language = language
        self.preset_base_path = "resource/preset/custom_prompt"
        self.language_code = "zh" if language == BaseLanguage.Enum.ZH else "en"

        # 载入配置
        config = Config().load()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_header(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_footer(self.root, config, window)

        # 注册事件：工程加载后刷新数据（从 .lg 文件读取）
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        # 工程卸载后清空数据
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

    # 获取自定义提示词数据
    def get_custom_prompt_data(self) -> str:
        if self.language == BaseLanguage.Enum.ZH:
            return DataManager.get().get_custom_prompt_zh()
        return DataManager.get().get_custom_prompt_en()

    # 保存自定义提示词数据
    def set_custom_prompt_data(self, data: str) -> None:
        if self.language == BaseLanguage.Enum.ZH:
            DataManager.get().set_custom_prompt_zh(data)
        else:
            DataManager.get().set_custom_prompt_en(data)

    # 获取启用状态
    def get_custom_prompt_enable(self) -> bool:
        if self.language == BaseLanguage.Enum.ZH:
            return DataManager.get().get_custom_prompt_zh_enable()
        return DataManager.get().get_custom_prompt_en_enable()

    # 设置启用状态
    def set_custom_prompt_enable(self, enable: bool) -> None:
        if self.language == BaseLanguage.Enum.ZH:
            DataManager.get().set_custom_prompt_zh_enable(enable)
        else:
            DataManager.get().set_custom_prompt_en_enable(enable)

    # 工程加载后刷新数据
    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        prompt_data = self.get_custom_prompt_data()

        # 如果数据为空（新工程），则加载默认提示词
        if not prompt_data:
            config = Config().load()
            prompt_data = PromptBuilder(config).get_base(self.language)
            self.set_custom_prompt_data(prompt_data)

        self.main_text.setPlainText(prompt_data)
        # 刷新开关状态
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(
                self.get_custom_prompt_enable()
            )

    # 工程卸载后清空数据
    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        self.main_text.clear()
        # 重置开关状态
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(True)

    # 头部
    def add_widget_header(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        base_key = (
            "custom_prompt_zh"
            if self.language == BaseLanguage.Enum.ZH
            else "custom_prompt_en"
        )

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(self.get_custom_prompt_enable())

        def checked_changed(widget: SwitchButtonCard) -> None:
            self.set_custom_prompt_enable(widget.get_switch_button().isChecked())

        self.switch_card = SwitchButtonCard(
            title=getattr(Localizer.get(), f"{base_key}_page_head"),
            description=getattr(Localizer.get(), f"{base_key}_page_head_desc"),
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.switch_card)

    # 主体
    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.prefix_body = EmptyCard(
            "", PromptBuilder(config).get_prefix(self.language)
        )
        self.prefix_body.remove_title()
        parent.addWidget(self.prefix_body)

        self.main_text = CustomTextEdit(self)
        self.main_text.setPlainText("")
        parent.addWidget(self.main_text)

        self.suffix_body = EmptyCard(
            "", PromptBuilder(config).get_suffix(self.language).replace("\n", "")
        )
        self.suffix_body.remove_title()
        parent.addWidget(self.suffix_body)

    # 底部
    def add_widget_footer(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.add_command_bar_action_save(self.command_bar_card, config, window)
        self.add_command_bar_action_preset(self.command_bar_card, config, window)

    # 保存
    def add_command_bar_action_save(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            # 保存数据
            self.set_custom_prompt_data(self.main_text.toPlainText().strip())

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().toast_saved,
                },
            )

        parent.add_action(
            Action(
                FluentIcon.SAVE,
                Localizer.get().save,
                parent,
                triggered=triggered,
            ),
        )

    # 预设
    def add_command_bar_action_preset(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        widget: CommandButton = None

        def get_preset_paths() -> tuple[list[dict], list[dict]]:
            builtin_dir = f"{self.preset_base_path}/{self.language_code}"
            user_dir = f"{self.preset_base_path}/user/{self.language_code}"

            builtin_presets = []
            user_presets = []

            # 加载内置预设
            if os.path.exists(builtin_dir):
                for f in os.listdir(builtin_dir):
                    if f.lower().endswith(".txt"):
                        path = os.path.join(builtin_dir, f).replace("\\", "/")
                        builtin_presets.append(
                            {
                                "name": f[:-4],
                                "path": path,
                                "type": "builtin",
                            }
                        )

            # 加载用户预设
            if not os.path.exists(user_dir):
                os.makedirs(user_dir)

            for f in os.listdir(user_dir):
                if f.lower().endswith(".txt"):
                    path = os.path.join(user_dir, f).replace("\\", "/")
                    user_presets.append(
                        {
                            "name": f[:-4],
                            "path": path,
                            "type": "user",
                        }
                    )

            return builtin_presets, user_presets

        def set_default_preset(item: dict) -> None:
            key = f"custom_prompt_{self.language_code}_default_preset"
            # 重新加载配置以防止覆盖其他页面的修改
            current_config = Config().load()
            setattr(current_config, key, item["path"])
            current_config.save()

            # 更新当前页面的配置对象
            setattr(config, key, item["path"])

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_set_default_preset_success,
                },
            )

        def cancel_default_preset() -> None:
            key = f"custom_prompt_{self.language_code}_default_preset"
            # 重新加载配置以防止覆盖其他页面的修改
            current_config = Config().load()
            setattr(current_config, key, "")
            current_config.save()

            # 更新当前页面的配置对象
            setattr(config, key, "")

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_cancel_default_preset_success,
                },
            )

        def reset() -> None:
            message_box = MessageBox(
                Localizer.get().alert, Localizer.get().alert_confirm_reset_data, window
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            # 重置为默认提示词
            config = Config().load()
            default_prompt = PromptBuilder(config).get_base(self.language)
            self.set_custom_prompt_data(default_prompt)

            # 更新 UI
            self.main_text.setPlainText(default_prompt)

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().toast_reset,
                },
            )

        def apply_preset(path: str) -> None:
            prompt: str = ""
            try:
                with open(path, "r", encoding="utf-8-sig") as reader:
                    prompt = reader.read().strip()
            except Exception:
                pass

            # 保存数据
            self.set_custom_prompt_data(prompt)

            # 更新 UI
            self.main_text.setPlainText(prompt)

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_import_toast,
                },
            )

        def save_preset() -> None:
            def on_save(dialog: LineEditMessageBox, text: str) -> None:
                if not text.strip():
                    return

                path = f"{self.preset_base_path}/user/{self.language_code}/{text.strip()}.txt"
                user_dir = os.path.dirname(path)
                if not os.path.exists(user_dir):
                    os.makedirs(user_dir)

                if os.path.exists(path):
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
                    data = self.main_text.toPlainText().strip()
                    with open(path, "w", encoding="utf-8") as writer:
                        writer.write(data)

                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().quality_save_preset_success,
                        },
                    )
                    dialog.accept()
                except Exception as e:
                    self.error("Failed to save preset", e)

            dialog = LineEditMessageBox(
                window, Localizer.get().quality_save_preset_title, on_save
            )
            dialog.exec()

        def rename_preset(item: dict) -> None:
            def on_rename(dialog: LineEditMessageBox, text: str) -> None:
                if not text.strip():
                    return

                new_path = os.path.join(
                    os.path.dirname(item["path"]), text.strip() + ".txt"
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
                    os.rename(item["path"], new_path)
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().task_success,
                        },
                    )
                    dialog.accept()
                except Exception as e:
                    self.error("Failed to rename preset", e)

            dialog = LineEditMessageBox(window, Localizer.get().rename, on_rename)
            dialog.get_line_edit().setText(item["name"])
            dialog.exec()

        def delete_preset(item: dict) -> None:
            message_box = MessageBox(
                Localizer.get().warning,
                Localizer.get().alert_delete_preset.format(NAME=item["name"]),
                window,
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if message_box.exec():
                try:
                    os.remove(item["path"])

                    # 如果删除的是默认预设，则清除配置
                    current_config = Config().load()
                    key = f"custom_prompt_{self.language_code}_default_preset"
                    if getattr(current_config, key) == item["path"]:
                        setattr(current_config, key, "")
                        current_config.save()
                        # 更新当前页面的配置对象
                        setattr(config, key, "")

                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().task_success,
                        },
                    )
                except Exception as e:
                    self.error("Failed to delete preset", e)

        def triggered() -> None:
            menu = RoundMenu("", widget)

            # 重置
            menu.addAction(
                Action(
                    FluentIcon.ERASE_TOOL,
                    Localizer.get().reset,
                    triggered=reset,
                )
            )

            # 保存
            menu.addAction(
                Action(
                    FluentIcon.SAVE,
                    Localizer.get().quality_save_preset,
                    triggered=save_preset,
                )
            )

            menu.addSeparator()

            builtin_presets, user_presets = get_preset_paths()

            # 内置预设
            for item in builtin_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(FluentIcon.FOLDER)
                sub_menu.addAction(
                    Action(
                        FluentIcon.DOWNLOAD,
                        Localizer.get().quality_import,
                        triggered=partial(apply_preset, item["path"]),
                    )
                )

                sub_menu.addSeparator()

                # 默认预设控制
                key = f"custom_prompt_{self.language_code}_default_preset"
                if getattr(config, key) == item["path"]:
                    sub_menu.setIcon(FluentIcon.CERTIFICATE)
                    sub_menu.addAction(
                        Action(
                            FluentIcon.FLAG,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            FluentIcon.TAG,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(set_default_preset, item),
                        )
                    )

                menu.addMenu(sub_menu)

            # 如果需要分隔符
            if builtin_presets and user_presets:
                menu.addSeparator()

            # 用户预设
            for item in user_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(FluentIcon.FOLDER_ADD)

                # 应用
                sub_menu.addAction(
                    Action(
                        FluentIcon.DOWNLOAD,
                        Localizer.get().quality_import,
                        triggered=partial(apply_preset, item["path"]),
                    )
                )

                # 重命名
                sub_menu.addAction(
                    Action(
                        FluentIcon.EDIT,
                        Localizer.get().rename,
                        triggered=partial(rename_preset, item),
                    )
                )

                # 删除
                sub_menu.addAction(
                    Action(
                        FluentIcon.DELETE,
                        Localizer.get().quality_delete_preset,
                        triggered=partial(delete_preset, item),
                    )
                )

                sub_menu.addSeparator()

                # 默认预设控制
                key = f"custom_prompt_{self.language_code}_default_preset"
                if getattr(config, key) == item["path"]:
                    sub_menu.setIcon(FluentIcon.CERTIFICATE)
                    sub_menu.addAction(
                        Action(
                            FluentIcon.CLEAR_SELECTION,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            FluentIcon.CERTIFICATE,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(set_default_preset, item),
                        )
                    )

                menu.addMenu(sub_menu)

            # 计算弹出位置（向上弹出）
            global_pos = widget.mapToGlobal(QPoint(0, 0))
            menu.exec(global_pos, ani=True, aniType=MenuAnimationType.PULL_UP)

        widget = parent.add_action(
            Action(
                FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                Localizer.get().quality_preset,
                parent=parent,
                triggered=triggered,
            )
        )
