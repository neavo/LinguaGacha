import re
from typing import Any
from typing import cast

from PySide6.QtCore import QPoint
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHeaderView
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import ComboBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Quality.QualityRuleIconHelper import IconColumnConfig
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconDelegate
from frontend.Quality.QualityRulePageBase import QualityRulePageBase
from frontend.Quality.TextPreserveEditPanel import TextPreserveEditPanel
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics
from widget.SettingCard import SettingCard


# ==================== 图标常量 ====================

ICON_MENU_DELETE: BaseIcon = BaseIcon.TRASH_2  # 右键菜单：删除条目


class TextPreservePage(QualityRulePageBase):
    PRESET_DIR_NAME: str = "text_preserve"
    DEFAULT_PRESET_CONFIG_KEY: str = "text_preserve_default_preset"

    QUALITY_RULE_TYPES: set[str] = {DataManager.RuleType.TEXT_PRESERVE.value}
    QUALITY_META_KEYS: set[str] = {"text_preserve_mode"}

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

    def create_edit_panel(self, parent: QWidget) -> TextPreserveEditPanel:
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
            Localizer.get().table_col_rule,
            Localizer.get().text_preserve_page_table_row_02,
        )

    def get_row_values(self, entry: dict[str, Any]) -> tuple[str, ...]:
        return (
            str(entry.get("src", "")),
            str(entry.get("info", "")),
        )

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1)

    def build_statistics_entry_key(self, entry: dict[str, Any]) -> str:
        return str(entry.get("src", "")).strip()

    def build_statistics_inputs(
        self, entries: list[dict[str, Any]] | None = None
    ) -> list[QualityRuleStatistics.RuleStatInput]:
        rules: list[QualityRuleStatistics.RuleStatInput] = []
        entries_source = self.entries if entries is None else entries
        for entry in entries_source:
            src = str(entry.get("src", "")).strip()
            if src == "":
                continue
            rules.append(
                QualityRuleStatistics.RuleStatInput(
                    key=self.build_statistics_entry_key(entry),
                    pattern=src,
                    mode=QualityRuleStatistics.RuleStatMode.TEXT_PRESERVE,
                    regex=True,
                )
            )
        return rules

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
        if hasattr(self, "mode_combo") and self.mode_combo is not None:
            self.update_mode_ui(self.get_mode())
        if hasattr(self, "search_card"):
            self.search_card.reset_state()

    def on_project_unloaded_ui(self) -> None:
        if hasattr(self, "mode_combo") and self.mode_combo is not None:
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

        def current_changed(combo_box: ComboBox) -> None:
            if self.mode_updating:
                return

            mode = self.mode_from_index(combo_box.currentIndex())

            def action() -> None:
                self.set_mode(mode)
                self.update_mode_ui(mode)

            self.run_with_unsaved_guard(action)

        card = SettingCard(
            Localizer.get().app_text_preserve_page,
            Localizer.get().text_preserve_page_head_content,
            parent=self,
        )
        combo_box = ComboBox(card)
        combo_box.addItems(items)
        combo_box.currentIndexChanged.connect(lambda index: current_changed(combo_box))
        card.add_right_widget(combo_box)
        parent.addWidget(card)
        self.mode_combo = combo_box
        self.update_mode_ui(self.get_mode())

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
        if not hasattr(self, "mode_combo") or self.mode_combo is None:
            return

        index = self.index_from_mode(mode)
        self.mode_updating = True
        self.mode_combo.setCurrentIndex(index)
        self.mode_updating = False

    def setup_table_columns(self) -> None:
        header = cast(QHeaderView, self.table.horizontalHeader())
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(
            self.statistics_column_index, QHeaderView.ResizeMode.Fixed
        )
        self.table.setColumnWidth(
            self.statistics_column_index,
            self.STATISTICS_COLUMN_WIDTH,
        )
        self.table.setItemDelegate(
            QualityRuleIconDelegate(
                self.table,
                icon_column_index=self.statistics_column_index,
                icon_size=self.STATISTICS_ICON_SIZE,
                icon_column_configs=[
                    IconColumnConfig(
                        column_index=self.statistics_column_index,
                        icon_count=2,
                        icon_tooltip_getter=self.get_statistics_icon_tooltip_by_source_row,
                    )
                ],
            )
        )

        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.on_table_context_menu)

    def on_table_context_menu(self, position: QPoint) -> None:
        rows = self.get_selected_entry_rows()
        if not rows:
            return

        menu = RoundMenu("", self.table)
        menu.addAction(
            Action(
                ICON_MENU_DELETE,
                Localizer.get().delete,
                triggered=lambda: self.run_with_unsaved_guard(
                    self.delete_selected_entries
                ),
            )
        )
        self.add_reorder_actions_to_menu(menu, rows)

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
        self.delete_entries_by_rows_common(
            rows,
            emit_success_toast_when_empty=True,
        )

    # ==================== UI：命令栏 ====================

    def add_command_bar_actions(self, config: Config, window: FluentWindow) -> None:
        self.command_bar_card.set_minimum_width(640)

        self.add_command_bar_action_import(window)
        self.add_command_bar_action_export(window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_search()
        self.add_command_bar_action_statistics()
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki()
