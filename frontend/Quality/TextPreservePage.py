import re
from typing import Any
from typing import cast

from PyQt5.QtWidgets import QHeaderView
from qfluentwidgets import FluentWindow

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

    def apply_selection(self, row: int) -> None:
        super().apply_selection(row)
        if hasattr(self, "edit_panel"):
            self.edit_panel.set_readonly(
                self.get_mode() != DataManager.TextPreserveMode.CUSTOM
            )

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
            Localizer.get().text_preserve_mode_desc_off,
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

        desc = self.get_mode_description(mode)
        index = self.index_from_mode(mode)
        self.mode_updating = True
        self.mode_card.get_combo_box().setCurrentIndex(index)
        self.mode_card.set_description(desc)
        self.mode_updating = False

        is_custom = mode == DataManager.TextPreserveMode.CUSTOM
        if hasattr(self, "edit_panel"):
            self.edit_panel.set_readonly(not is_custom)
        if hasattr(self, "btn_import"):
            self.btn_import.setEnabled(is_custom)
        if hasattr(self, "btn_preset"):
            self.btn_preset.setEnabled(is_custom)

    def get_mode_description(self, mode: DataManager.TextPreserveMode) -> str:
        if mode == DataManager.TextPreserveMode.CUSTOM:
            return Localizer.get().text_preserve_mode_desc_custom
        if mode == DataManager.TextPreserveMode.SMART:
            return Localizer.get().text_preserve_mode_desc_smart
        return Localizer.get().text_preserve_mode_desc_off

    def setup_table_columns(self) -> None:
        header = cast(QHeaderView, self.table.horizontalHeader())
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)

    # ==================== UI：命令栏 ====================

    def add_command_bar_actions(self, config: Config, window: FluentWindow) -> None:
        self.command_bar_card.set_minimum_width(640)

        self.btn_import = self.add_command_bar_action_import(window)
        self.add_command_bar_action_export(window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_search()
        self.command_bar_card.add_separator()
        self.btn_preset = self.add_command_bar_action_preset(config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki()
