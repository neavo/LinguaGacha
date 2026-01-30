import json
import os
from functools import partial
from typing import TYPE_CHECKING

from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu

from base.Base import Base
from module.Config import Config
from module.Data.QualityRuleIO import QualityRuleIO
from module.Localizer.Localizer import Localizer
from widget.LineEditMessageBox import LineEditMessageBox

if TYPE_CHECKING:
    from frontend.Quality.QualityRulePageBase import QualityRulePageBase


class QualityRulePresetManager:
    """质量规则预设管理器。"""

    PRESET_EXTENSION: str = ".json"
    USER_DIR_NAME: str = "user"

    def __init__(
        self,
        preset_dir_name: str,
        default_preset_config_key: str,
        config: Config,
        page: "QualityRulePageBase",
        window: FluentWindow,
        reset_to_default: bool,
    ) -> None:
        self.preset_dir_name: str = preset_dir_name
        self.default_preset_config_key: str = default_preset_config_key
        self.config: Config = config
        self.page: "QualityRulePageBase" = page
        self.window: FluentWindow = window
        self.reset_to_default: bool = reset_to_default

    def get_preset_paths(self) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        builtin_dir = os.path.join(
            "resource",
            "preset",
            self.preset_dir_name,
            Localizer.get_app_language().lower(),
        )
        user_dir = os.path.join(
            "resource", "preset", self.preset_dir_name, self.USER_DIR_NAME
        )

        builtin_presets: list[dict[str, str]] = []
        user_presets: list[dict[str, str]] = []

        if os.path.exists(builtin_dir):
            for file_name in os.listdir(builtin_dir):
                if not file_name.lower().endswith(self.PRESET_EXTENSION):
                    continue
                path = os.path.join(builtin_dir, file_name).replace("\\", "/")
                builtin_presets.append(
                    {
                        "name": file_name[: -len(self.PRESET_EXTENSION)],
                        "path": path,
                        "type": "builtin",
                    }
                )

        if not os.path.exists(user_dir):
            os.makedirs(user_dir)

        for file_name in os.listdir(user_dir):
            if not file_name.lower().endswith(self.PRESET_EXTENSION):
                continue
            path = os.path.join(user_dir, file_name).replace("\\", "/")
            user_presets.append(
                {
                    "name": file_name[: -len(self.PRESET_EXTENSION)],
                    "path": path,
                    "type": "user",
                }
            )

        return builtin_presets, user_presets

    def apply_preset(self, path: str) -> None:
        self.page.import_rules_from_path(path)

    def save_preset(self, name: str) -> bool:
        name = name.strip()
        if not name:
            return False

        path = os.path.join(
            "resource",
            "preset",
            self.preset_dir_name,
            self.USER_DIR_NAME,
            f"{name}{self.PRESET_EXTENSION}",
        )
        user_dir = os.path.dirname(path)
        if not os.path.exists(user_dir):
            os.makedirs(user_dir)

        if os.path.exists(path):
            message_box = MessageBox(
                Localizer.get().warning,
                Localizer.get().alert_preset_already_exists,
                self.window,
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)
            if not message_box.exec():
                return False

        try:
            data = [v for v in self.page.entries if str(v.get("src", "")).strip()]
            with open(path, "w", encoding="utf-8") as writer:
                writer.write(json.dumps(data, indent=4, ensure_ascii=False))
            self.show_toast(
                Base.ToastType.SUCCESS, Localizer.get().quality_save_preset_success
            )
            return True
        except Exception as e:
            self.page.error("Failed to save preset", e)
            return False

    def rename_preset(self, item: dict[str, str], new_name: str) -> bool:
        new_name = new_name.strip()
        if not new_name:
            return False

        new_path = os.path.join(
            os.path.dirname(item["path"]), f"{new_name}{self.PRESET_EXTENSION}"
        )
        if os.path.exists(new_path):
            self.show_toast(
                Base.ToastType.WARNING, Localizer.get().alert_file_already_exists
            )
            return False

        try:
            os.rename(item["path"], new_path)
            self.show_toast(Base.ToastType.SUCCESS, Localizer.get().task_success)
            return True
        except Exception as e:
            self.page.error("Failed to rename preset", e)
            return False

    def delete_preset(self, item: dict[str, str]) -> None:
        message_box = MessageBox(
            Localizer.get().warning,
            Localizer.get().alert_delete_preset.format(NAME=item["name"]),
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        try:
            os.remove(item["path"])

            current_config = Config().load()
            if (
                getattr(current_config, self.default_preset_config_key, "")
                == item["path"]
            ):
                setattr(current_config, self.default_preset_config_key, "")
                current_config.save()
                setattr(self.config, self.default_preset_config_key, "")

            self.show_toast(Base.ToastType.SUCCESS, Localizer.get().task_success)
        except Exception as e:
            self.page.error("Failed to delete preset", e)

    def set_default_preset(self, item: dict[str, str]) -> None:
        current_config = Config().load()
        setattr(current_config, self.default_preset_config_key, item["path"])
        current_config.save()
        setattr(self.config, self.default_preset_config_key, item["path"])
        self.show_toast(
            Base.ToastType.SUCCESS, Localizer.get().quality_set_default_preset_success
        )

    def cancel_default_preset(self) -> None:
        current_config = Config().load()
        setattr(current_config, self.default_preset_config_key, "")
        current_config.save()
        setattr(self.config, self.default_preset_config_key, "")
        self.show_toast(
            Base.ToastType.SUCCESS,
            Localizer.get().quality_cancel_default_preset_success,
        )

    def reset(self) -> None:
        message_box = MessageBox(
            Localizer.get().alert, Localizer.get().quality_reset_alert, self.window
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        if self.reset_to_default:
            default_preset = getattr(self.config, self.default_preset_config_key, "")
            if default_preset and os.path.exists(default_preset):
                self.page.entries = QualityRuleIO.load_rules_from_file(default_preset)
                self.show_toast(
                    Base.ToastType.SUCCESS,
                    Localizer.get().quality_default_preset_loaded_toast.format(
                        NAME=os.path.basename(default_preset)
                    ),
                )
            else:
                self.page.entries = []
        else:
            self.page.entries = []

        self.page.save_entries(self.page.entries)
        self.page.refresh_table()
        self.page.select_row(0 if self.page.entries else -1)
        self.show_toast(Base.ToastType.SUCCESS, Localizer.get().quality_reset_toast)

    def build_preset_menu(self, parent_widget: QWidget) -> RoundMenu:
        menu = RoundMenu("", parent_widget)
        menu.addAction(
            Action(
                FluentIcon.ERASE_TOOL,
                Localizer.get().quality_reset,
                triggered=lambda: self.page.run_with_unsaved_guard(self.reset),
            )
        )
        menu.addAction(
            Action(
                FluentIcon.SAVE,
                Localizer.get().quality_save_preset,
                triggered=lambda: self.page.run_with_unsaved_guard(
                    self.prompt_save_preset
                ),
            )
        )
        menu.addSeparator()

        builtin_presets, user_presets = self.get_preset_paths()

        for item in builtin_presets:
            sub_menu = RoundMenu(item["name"], menu)
            sub_menu.setIcon(FluentIcon.FOLDER)
            sub_menu.addAction(
                Action(
                    FluentIcon.DOWNLOAD,
                    Localizer.get().quality_import,
                    triggered=partial(
                        lambda p: self.page.run_with_unsaved_guard(
                            lambda: self.apply_preset(p)
                        ),
                        item["path"],
                    ),
                )
            )
            sub_menu.addSeparator()

            if self.is_default_preset(item):
                sub_menu.setIcon(FluentIcon.CERTIFICATE)
                sub_menu.addAction(
                    Action(
                        FluentIcon.FLAG,
                        Localizer.get().quality_cancel_default_preset,
                        triggered=self.cancel_default_preset,
                    )
                )
            else:
                sub_menu.addAction(
                    Action(
                        FluentIcon.TAG,
                        Localizer.get().quality_set_as_default_preset,
                        triggered=partial(self.set_default_preset, item),
                    )
                )

            menu.addMenu(sub_menu)

        if builtin_presets and user_presets:
            menu.addSeparator()

        for item in user_presets:
            sub_menu = RoundMenu(item["name"], menu)
            sub_menu.setIcon(FluentIcon.FOLDER_ADD)
            sub_menu.addAction(
                Action(
                    FluentIcon.DOWNLOAD,
                    Localizer.get().quality_import,
                    triggered=partial(
                        lambda p: self.page.run_with_unsaved_guard(
                            lambda: self.apply_preset(p)
                        ),
                        item["path"],
                    ),
                )
            )
            sub_menu.addAction(
                Action(
                    FluentIcon.EDIT,
                    Localizer.get().rename,
                    triggered=partial(self.prompt_rename_preset, item),
                )
            )
            sub_menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().quality_delete_preset,
                    triggered=partial(self.delete_preset, item),
                )
            )
            sub_menu.addSeparator()

            if self.is_default_preset(item):
                sub_menu.setIcon(FluentIcon.CERTIFICATE)
                sub_menu.addAction(
                    Action(
                        FluentIcon.CLEAR_SELECTION,
                        Localizer.get().quality_cancel_default_preset,
                        triggered=self.cancel_default_preset,
                    )
                )
            else:
                sub_menu.addAction(
                    Action(
                        FluentIcon.CERTIFICATE,
                        Localizer.get().quality_set_as_default_preset,
                        triggered=partial(self.set_default_preset, item),
                    )
                )

            menu.addMenu(sub_menu)

        return menu

    def prompt_save_preset(self) -> None:
        def on_save(dialog: LineEditMessageBox, text: str) -> None:
            if self.save_preset(text):
                dialog.accept()

        dialog = LineEditMessageBox(
            self.window, Localizer.get().quality_save_preset_title, on_save
        )
        dialog.exec()

    def prompt_rename_preset(self, item: dict[str, str]) -> None:
        def on_rename(dialog: LineEditMessageBox, text: str) -> None:
            if self.rename_preset(item, text):
                dialog.accept()

        dialog = LineEditMessageBox(self.window, Localizer.get().rename, on_rename)
        dialog.get_line_edit().setText(item["name"])
        dialog.exec()

    def is_default_preset(self, item: dict[str, str]) -> bool:
        return getattr(self.config, self.default_preset_config_key, "") == item["path"]

    def show_toast(self, toast_type: Base.ToastType, message: str) -> None:
        self.page.emit(Base.Event.TOAST, {"type": toast_type, "message": message})
