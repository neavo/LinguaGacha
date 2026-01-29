import json
import os
from functools import partial
from pathlib import Path
from typing import Any

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import MessageBox
from qfluentwidgets import PillToolButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import getFont
from qfluentwidgets import setCustomStyleSheet

from base.Base import Base
from frontend.Quality.GlossaryEditPanel import GlossaryEditPanel
from frontend.Quality.QualityRuleSplitPageBase import QualityRuleSplitPageBase
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.QualityRuleIO import QualityRuleIO
from module.Data.QualityRuleMerge import QualityRuleMerge
from module.Localizer.Localizer import Localizer
from widget.LineEditMessageBox import LineEditMessageBox
from widget.SwitchButtonCard import SwitchButtonCard


class GlossaryPage(QualityRuleSplitPageBase):
    BASE: str = "glossary"

    QUALITY_RULE_TYPES: set[str] = {DataManager.RuleType.GLOSSARY.value}
    QUALITY_META_KEYS: set[str] = {"glossary_enable"}

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(text, window)

        # 载入并保存默认配置
        config = Config().load().save()

        self.add_widget_head(self.root, config, window)
        self.setup_split_body(self.root)
        self.setup_table_columns()
        self.setup_split_foot(self.root)
        self.add_command_bar_actions(config, window)

        # 注册事件
        self.subscribe(Base.Event.QUALITY_RULE_UPDATE, self.on_quality_rule_update)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

    # ==================== DataManager 适配 ====================

    def load_entries(self) -> list[dict[str, Any]]:
        return DataManager.get().get_glossary()

    def save_entries(self, entries: list[dict[str, Any]]) -> None:
        DataManager.get().set_glossary(entries)

    def get_glossary_enable(self) -> bool:
        return DataManager.get().get_glossary_enable()

    def set_glossary_enable(self, enable: bool) -> None:
        DataManager.get().set_glossary_enable(enable)

    # ==================== SplitPageBase hooks ====================

    def create_edit_panel(self, parent) -> GlossaryEditPanel:
        panel = GlossaryEditPanel(parent)
        panel.save_requested.connect(self.save_current_entry)
        panel.delete_requested.connect(self.delete_current_entry)
        return panel

    def get_list_headers(self) -> tuple[str, ...]:
        return (
            Localizer.get().glossary_page_table_row_01,
            Localizer.get().glossary_page_table_row_02,
            Localizer.get().glossary_page_table_row_04,
            Localizer.get().glossary_page_table_row_03,
        )

    def get_row_values(self, entry: dict[str, Any]) -> tuple[str, ...]:
        # 高级规则列使用 cell widget，不需要文本
        return (
            str(entry.get("src", "")),
            str(entry.get("dst", "")),
            str(entry.get("info", "")),
            "",
        )

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1, 2)

    def on_entries_reloaded(self) -> None:
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(self.get_glossary_enable())
        if hasattr(self, "search_card"):
            self.search_card.reset_state()

    # ==================== 事件 ====================

    def on_quality_rule_update(self, event: Base.Event, data: dict) -> None:
        del event
        if not self.is_quality_rule_update_relevant(data):
            return
        self.request_reload()

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.reload_entries()

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.entries = []
        self.current_index = -1
        self.refresh_table()
        if hasattr(self, "edit_panel"):
            self.edit_panel.clear()
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(True)
        if hasattr(self, "search_card"):
            self.search_card.reset_state()
            self.search_card.setVisible(False)
        if hasattr(self, "command_bar_card"):
            self.command_bar_card.setVisible(True)

    # ==================== UI：头部 ====================

    def add_widget_head(self, parent, config: Config, window: FluentWindow) -> None:
        del window

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(self.get_glossary_enable())

        def checked_changed(widget: SwitchButtonCard) -> None:
            self.set_glossary_enable(widget.get_switch_button().isChecked())

        self.switch_card = SwitchButtonCard(
            Localizer.get().glossary_page_head_title,
            Localizer.get().glossary_page_head_content,
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.switch_card)

    def setup_table_columns(self) -> None:
        # 表格字体：12号，与校对页保持一致
        self.ui_font = getFont(12)
        self.ui_font.setHintingPreference(self.table.font().hintingPreference())

        # 表头字体：通过 QSS 覆盖默认值
        header_qss = "QHeaderView::section {\n    font: 12px --FontFamilies;\n}\n"
        setCustomStyleSheet(self.table, header_qss, header_qss)

        # 禁用水平滚动条
        self.table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        # 单行显示，超长截断
        self.table.setWordWrap(False)
        self.table.setTextElideMode(Qt.TextElideMode.ElideRight)

        # 列宽：原文/译文拉伸，描述拉伸，高级规则列固定窄宽
        header = self.table.horizontalHeader()
        if header is not None:
            header.setStretchLastSection(False)
            # 原文、译文、描述均拉伸
            header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
            # 高级规则列固定宽度
            header.setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)
            self.table.setColumnWidth(3, 96)

    def clear_cell_widgets(self) -> None:
        """移除所有 cell widgets"""
        for row in range(self.table.rowCount()):
            widget = self.table.cellWidget(row, 3)
            if widget:
                self.table.removeCellWidget(row, 3)
                widget.deleteLater()

    def create_case_widget(self, case_sensitive: bool, show_button: bool) -> QWidget:
        """创建高级规则列的 cell widget

        Args:
            case_sensitive: 是否启用大小写敏感
            show_button: 是否显示按钮（空白行不显示）
        """
        widget = QWidget()
        widget.setFixedHeight(40)
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        if show_button:
            btn = PillToolButton(FluentIcon.FONT, widget)
            btn.setIconSize(QSize(14, 14))
            btn.setFixedSize(28, 28)
            btn.setCheckable(True)
            btn.setChecked(case_sensitive)
            # 禁用焦点以避免点击时出现焦点框
            btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            btn.installEventFilter(ToolTipFilter(btn, 300, ToolTipPosition.TOP))
            btn.setToolTip(Localizer.get().rule_case_sensitive)
            layout.addWidget(btn)

        return widget

    def refresh_table(self) -> None:
        """重写刷新表格方法，为每个单元格设置字体"""
        self.table.blockSignals(True)
        self.table.setUpdatesEnabled(False)

        # 先清除所有 cell widgets
        self.clear_cell_widgets()

        headers = self.get_list_headers()
        col_count = len(headers)
        self.table.setColumnCount(col_count)
        self.table.setHorizontalHeaderLabels(headers)

        target_count = max(20, len(self.entries))
        self.table.setRowCount(target_count)

        for row in range(target_count):
            values = ("",) * col_count
            editable = False
            case_sensitive = False

            if row < len(self.entries):
                values = self.get_row_values(self.entries[row])
                editable = True
                case_sensitive = bool(self.entries[row].get("case_sensitive", False))

            for col in range(col_count):
                # 高级规则列使用 cell widget
                if col == 3:
                    self.table.setCellWidget(
                        row, col, self.create_case_widget(case_sensitive, editable)
                    )
                    # 仍需设置空 item 以支持选中
                    item = self.table.item(row, col)
                    if item is None:
                        item = QTableWidgetItem()
                        self.table.setItem(row, col, item)
                    item.setText("")
                    if editable:
                        item.setFlags(
                            Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable
                        )
                    else:
                        item.setFlags(Qt.ItemFlag.ItemIsEnabled)
                    continue

                item = self.table.item(row, col)
                if item is None:
                    item = QTableWidgetItem()
                    self.table.setItem(row, col, item)

                item.setText(values[col] if col < len(values) else "")
                item.setFont(self.ui_font)
                item.setTextAlignment(
                    Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
                )
                if editable:
                    item.setFlags(
                        Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable
                    )
                else:
                    item.setFlags(Qt.ItemFlag.ItemIsEnabled)

        self.table.setUpdatesEnabled(True)
        self.table.blockSignals(False)

    # ==================== UI：命令栏 ====================

    def add_command_bar_actions(self, config: Config, window: FluentWindow) -> None:
        self.command_bar_card.set_minimum_width(640)

        self.add_command_bar_action_add()
        self.command_bar_card.add_separator()
        self.add_command_bar_action_import(window)
        self.add_command_bar_action_export(window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_search()
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_kg()
        self.add_command_bar_action_wiki()

    def add_command_bar_action_add(self) -> None:
        def action() -> None:
            self.entries.append(
                {
                    "src": "",
                    "dst": "",
                    "info": "",
                    "case_sensitive": False,
                }
            )
            self.refresh_table()
            self.select_row(len(self.entries) - 1)

        self.command_bar_card.add_action(
            Action(
                FluentIcon.ADD,
                Localizer.get().add,
                triggered=lambda: self.run_with_unsaved_guard(action),
            )
        )

    def import_rules_from_path(self, path: str) -> None:
        current_src = ""
        if 0 <= self.current_index < len(self.entries):
            current_src = str(self.entries[self.current_index].get("src", "")).strip()

        incoming = QualityRuleIO.load_rules_from_file(path)
        merged, report = QualityRuleMerge.merge_overwrite(self.entries, incoming)
        self.entries = merged
        self.cleanup_empty_entries()
        self.save_entries(self.entries)
        self.refresh_table()

        if current_src:
            for i, v in enumerate(self.entries):
                if str(v.get("src", "")).strip() == current_src:
                    self.select_row(i)
                    break
        elif self.entries:
            self.select_row(0)

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            },
        )

        if report.updated > 0:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().quality_merge_duplication,
                },
            )

    def add_command_bar_action_import(self, window: FluentWindow) -> None:
        def triggered() -> None:
            path, _ = QFileDialog.getOpenFileName(
                None,
                Localizer.get().quality_select_file,
                "",
                Localizer.get().quality_select_file_type,
            )
            if not isinstance(path, str) or not path:
                return

            self.import_rules_from_path(path)

        self.command_bar_card.add_action(
            Action(
                FluentIcon.DOWNLOAD,
                Localizer.get().quality_import,
                triggered=lambda: self.run_with_unsaved_guard(triggered),
            )
        )

    def add_command_bar_action_export(self, window: FluentWindow) -> None:
        def triggered() -> None:
            path, _ = QFileDialog.getSaveFileName(
                window,
                Localizer.get().quality_select_file,
                "",
                Localizer.get().quality_select_file_type,
            )
            if not isinstance(path, str) or not path:
                return

            QualityRuleIO.export_rules(str(Path(path).with_suffix("")), self.entries)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_export_toast,
                },
            )

        self.command_bar_card.add_action(
            Action(
                FluentIcon.SHARE,
                Localizer.get().quality_export,
                triggered=lambda: self.run_with_unsaved_guard(triggered),
            )
        )

    def add_command_bar_action_search(self) -> None:
        self.command_bar_card.add_action(
            Action(
                FluentIcon.SEARCH,
                Localizer.get().search,
                triggered=self.show_search_bar,
            )
        )

    def add_command_bar_action_preset(
        self, config: Config, window: FluentWindow
    ) -> None:
        def get_preset_paths() -> tuple[list[dict], list[dict]]:
            builtin_dir = (
                f"resource/preset/{self.BASE}/{Localizer.get_app_language().lower()}"
            )
            user_dir = f"resource/preset/{self.BASE}/user"

            builtin_presets: list[dict] = []
            user_presets: list[dict] = []

            if os.path.exists(builtin_dir):
                for f in os.listdir(builtin_dir):
                    if f.lower().endswith(".json"):
                        path = os.path.join(builtin_dir, f).replace("\\", "/")
                        builtin_presets.append(
                            {"name": f[:-5], "path": path, "type": "builtin"}
                        )

            if not os.path.exists(user_dir):
                os.makedirs(user_dir)

            for f in os.listdir(user_dir):
                if f.lower().endswith(".json"):
                    path = os.path.join(user_dir, f).replace("\\", "/")
                    user_presets.append({"name": f[:-5], "path": path, "type": "user"})

            return builtin_presets, user_presets

        def set_default_preset(item: dict) -> None:
            current_config = Config().load()
            current_config.glossary_default_preset = item["path"]
            current_config.save()
            config.glossary_default_preset = item["path"]
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_set_default_preset_success,
                },
            )

        def cancel_default_preset() -> None:
            current_config = Config().load()
            current_config.glossary_default_preset = ""
            current_config.save()
            config.glossary_default_preset = ""
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_cancel_default_preset_success,
                },
            )

        def reset() -> None:
            message_box = MessageBox(
                Localizer.get().alert, Localizer.get().quality_reset_alert, window
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)
            if not message_box.exec():
                return

            self.entries = []
            self.save_entries(self.entries)
            self.refresh_table()
            self.select_row(-1)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_reset_toast,
                },
            )

        def apply_preset(path: str) -> None:
            self.import_rules_from_path(path)

        def save_preset() -> None:
            def on_save(dialog: LineEditMessageBox, text: str) -> None:
                if not text.strip():
                    return

                path = f"resource/preset/{self.BASE}/user/{text.strip()}.json"
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
                    data = [v for v in self.entries if str(v.get("src", "")).strip()]
                    with open(path, "w", encoding="utf-8") as writer:
                        writer.write(json.dumps(data, indent=4, ensure_ascii=False))
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
                    os.path.dirname(item["path"]), text.strip() + ".json"
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
            if not message_box.exec():
                return

            try:
                os.remove(item["path"])

                current_config = Config().load()
                if current_config.glossary_default_preset == item["path"]:
                    current_config.glossary_default_preset = ""
                    current_config.save()
                    config.glossary_default_preset = ""

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
            menu.addAction(
                Action(
                    FluentIcon.ERASE_TOOL,
                    Localizer.get().quality_reset,
                    triggered=lambda: self.run_with_unsaved_guard(reset),
                )
            )
            menu.addAction(
                Action(
                    FluentIcon.SAVE,
                    Localizer.get().quality_save_preset,
                    triggered=lambda: self.run_with_unsaved_guard(save_preset),
                )
            )
            menu.addSeparator()

            builtin_presets, user_presets = get_preset_paths()

            for item in builtin_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(FluentIcon.FOLDER)
                sub_menu.addAction(
                    Action(
                        FluentIcon.DOWNLOAD,
                        Localizer.get().quality_import,
                        triggered=partial(
                            lambda p: self.run_with_unsaved_guard(
                                lambda: apply_preset(p)
                            ),
                            item["path"],
                        ),
                    )
                )
                sub_menu.addSeparator()

                if config.glossary_default_preset == item["path"]:
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
                            lambda p: self.run_with_unsaved_guard(
                                lambda: apply_preset(p)
                            ),
                            item["path"],
                        ),
                    )
                )
                sub_menu.addAction(
                    Action(
                        FluentIcon.EDIT,
                        Localizer.get().rename,
                        triggered=partial(rename_preset, item),
                    )
                )
                sub_menu.addAction(
                    Action(
                        FluentIcon.DELETE,
                        Localizer.get().quality_delete_preset,
                        triggered=partial(delete_preset, item),
                    )
                )
                sub_menu.addSeparator()

                if config.glossary_default_preset == item["path"]:
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

            global_pos = widget.mapToGlobal(QPoint(0, 0))
            menu.exec(global_pos, ani=True, aniType=MenuAnimationType.PULL_UP)

        widget = self.command_bar_card.add_action(
            Action(
                FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                Localizer.get().quality_preset,
                triggered=triggered,
            )
        )

    def add_command_bar_action_kg(self) -> None:
        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/KeywordGacha"))

        push_button = TransparentPushButton(
            FluentIcon.ROBOT, Localizer.get().glossary_page_kg
        )
        push_button.clicked.connect(connect)
        self.command_bar_card.add_widget(push_button)

    def add_command_bar_action_wiki(self) -> None:
        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki"))

        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(connect)
        self.command_bar_card.add_widget(push_button)
