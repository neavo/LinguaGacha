import re
from typing import Any
from typing import cast

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHeaderView
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu

from base.Base import Base
from frontend.Quality.QualityRulePageBase import QualityRulePageBase
from frontend.Quality.TextPreserveEditPanel import TextPreserveEditPanel
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from widget.ComboBoxCard import ComboBoxCard


class TextPreservePage(QualityRulePageBase):
    PRESET_DIR_NAME: str = "text_preserve"
    DEFAULT_PRESET_CONFIG_KEY: str = "text_preserve_default_preset"

    QUALITY_RULE_TYPES: set[str] = {DataManager.RuleType.TEXT_PRESERVE.value}
    QUALITY_META_KEYS: set[str] = {"text_preserve_mode", "text_preserve_enable"}

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(text, window)

        config = Config().load().save()

        self.add_widget_head(self.root, config, window)
        self.setup_split_body(self.root)
        self.setup_table_columns()
        self.setup_split_foot(self.root)
        self.add_command_bar_actions(config, window)

        self.subscribe(Base.Event.QUALITY_RULE_UPDATE, self.on_quality_rule_update)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

    # ==================== DataManager 适配 ====================

    def load_entries(self) -> list[dict[str, Any]]:
        return DataManager.get().get_text_preserve()

    def save_entries(self, entries: list[dict[str, Any]]) -> None:
        DataManager.get().set_text_preserve(entries)

    def get_mode(self) -> DataManager.TextPreserveMode:
        return DataManager.get().get_text_preserve_mode()

    def set_mode(self, mode: DataManager.TextPreserveMode) -> None:
        DataManager.get().set_text_preserve_mode(mode)

    # ==================== SplitPageBase hooks ====================

    def create_edit_panel(self, parent) -> TextPreserveEditPanel:
        panel = TextPreserveEditPanel(parent)
        panel.add_requested.connect(
            lambda: self.run_with_unsaved_guard(self.add_entry_after_current)
        )
        panel.save_requested.connect(self.save_current_entry)
        panel.delete_requested.connect(self.delete_current_entry)
        return panel

    def create_empty_entry(self) -> dict[str, Any]:
        return {"src": "", "info": ""}

    def get_list_headers(self) -> tuple[str, ...]:
        return (
            Localizer.get().text_preserve_page_table_row_01,
            Localizer.get().text_preserve_page_table_row_02,
        )

    def get_row_values(self, entry: dict[str, Any]) -> tuple[str, ...]:
        return (
            str(entry.get("src", "")),
            str(entry.get("info", "")),
        )

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1)

    def validate_entry(self, entry: dict[str, Any]) -> tuple[bool, str]:
        if hasattr(self, "edit_panel"):
            self.edit_panel.set_src_error(False)

        src = str(entry.get("src", "")).strip()
        if not src:
            return True, ""

        try:
            re.compile(src, re.IGNORECASE)
        except re.error as e:
            if hasattr(self, "edit_panel"):
                self.edit_panel.set_src_error(True)
            return False, f"{Localizer.get().search_regex_invalid}: {e}"

        return True, ""

    def on_entries_reloaded(self) -> None:
        if hasattr(self, "mode_card"):
            self.update_mode_ui(self.get_mode())
        if hasattr(self, "search_card"):
            self.search_card.reset_state()

    def on_project_unloaded_ui(self) -> None:
        if hasattr(self, "mode_card"):
            self.update_mode_ui(DataManager.TextPreserveMode.OFF)

    # ==================== UI：头部 ====================

    def add_widget_head(self, parent, config: Config, window: FluentWindow) -> None:
        del window

        self.mode_updating = False

        items = [
            Localizer.get().text_preserve_mode_off,
            Localizer.get().text_preserve_mode_smart,
            Localizer.get().text_preserve_mode_custom,
        ]

        def init(widget: ComboBoxCard) -> None:
            self.update_mode_ui(self.get_mode())

        def current_changed(widget: ComboBoxCard) -> None:
            if self.mode_updating:
                return

            mode = self.mode_from_index(widget.get_combo_box().currentIndex())

            def action() -> None:
                self.set_mode(mode)
                self.update_mode_ui(mode)

            self.run_with_unsaved_guard(action)

        self.mode_card = ComboBoxCard(
            Localizer.get().text_preserve_page_head_title,
            Localizer.get().text_preserve_page_head_content,
            items,
            init=init,
            current_changed=current_changed,
        )
        parent.addWidget(self.mode_card)

    def mode_from_index(self, index: int) -> DataManager.TextPreserveMode:
        if index == 2:
            return DataManager.TextPreserveMode.CUSTOM
        if index == 1:
            return DataManager.TextPreserveMode.SMART
        return DataManager.TextPreserveMode.OFF

    def index_from_mode(self, mode: DataManager.TextPreserveMode) -> int:
        if mode == DataManager.TextPreserveMode.CUSTOM:
            return 2
        if mode == DataManager.TextPreserveMode.SMART:
            return 1
        return 0

    def update_mode_ui(self, mode: DataManager.TextPreserveMode) -> None:
        if not hasattr(self, "mode_card"):
            return

        index = self.index_from_mode(mode)
        self.mode_updating = True
        self.mode_card.get_combo_box().setCurrentIndex(index)
        self.mode_updating = False

    def setup_table_columns(self) -> None:
        header = cast(QHeaderView, self.table.horizontalHeader())
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)

        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.on_table_context_menu)

    def get_selected_entry_rows(self) -> list[int]:
        selection_model = self.table.selectionModel()
        if selection_model is None:
            return []
        rows = [index.row() for index in selection_model.selectedRows()]
        return sorted({row for row in rows if 0 <= row < len(self.entries)})

    def on_table_context_menu(self, position: QPoint) -> None:
        rows = self.get_selected_entry_rows()
        if not rows:
            return

        menu = RoundMenu("", self.table)
        menu.addAction(
            Action(
                FluentIcon.DELETE,
                Localizer.get().delete,
                triggered=lambda: self.run_with_unsaved_guard(
                    self.delete_selected_entries
                ),
            )
        )

        viewport = self.table.viewport()
        if viewport is None:
            return
        menu.exec(viewport.mapToGlobal(position))

    def delete_selected_entries(self) -> None:
        self.delete_entries_by_rows(self.get_selected_entry_rows())

    def confirm_delete_entries(self, count: int) -> bool:
        message = Localizer.get().quality_delete_confirm.replace("{COUNT}", str(count))
        message_box = MessageBox(Localizer.get().confirm, message, self.main_window)
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        return bool(message_box.exec())

    def delete_entries_by_rows(self, rows: list[int]) -> None:
        if not rows:
            return

        unique_rows = sorted({row for row in rows if 0 <= row < len(self.entries)})
        if not unique_rows:
            return

        if not self.confirm_delete_entries(len(unique_rows)):
            return

        deleted_set = set(unique_rows)
        current_index = self.current_index

        for row in sorted(unique_rows, reverse=True):
            del self.entries[row]

        self.current_index = -1

        try:
            self.cleanup_empty_entries()
            self.save_entries(self.entries)
            # 避免自身保存触发的 QUALITY_RULE_UPDATE 重载。
            self.ignore_next_quality_rule_update = True
        except Exception as e:
            self.error("Failed to delete rules", e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            return

        self.refresh_table()

        if self.entries:
            if current_index >= 0 and current_index not in deleted_set:
                shift = sum(1 for row in deleted_set if row < current_index)
                next_index = current_index - shift
            else:
                next_index = min(deleted_set)
            if next_index >= len(self.entries):
                next_index = len(self.entries) - 1
            self.select_row(next_index)
        else:
            self.apply_selection(-1)

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_save_toast,
            },
        )

        if self.reload_pending:
            self.reload_entries()

    # ==================== UI：命令栏 ====================

    def add_command_bar_actions(self, config: Config, window: FluentWindow) -> None:
        self.command_bar_card.set_minimum_width(640)

        self.add_command_bar_action_import(window)
        self.add_command_bar_action_export(window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_search()
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki()
