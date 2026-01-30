import re
from typing import Any
from typing import cast

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import qconfig

from base.Base import Base
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconDelegate
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconRenderer
from frontend.Quality.QualityRuleIconHelper import RuleIconSpec
from frontend.Quality.QualityRulePageBase import QualityRulePageBase
from frontend.Quality.TextReplacementEditPanel import TextReplacementEditPanel
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from widget.SwitchButtonCard import SwitchButtonCard


class TextReplacementPage(QualityRulePageBase):
    RULE_COLUMN_INDEX: int = 2
    RULE_ICON_SIZE: int = 24
    RULE_ICON_INNER_SIZE: int = 12
    RULE_ICON_BORDER_WIDTH: int = 1
    RULE_ICON_LUMA_THRESHOLD: float = 0.75
    RULE_ICON_SPACING: int = 4
    RULE_COLUMN_WIDTH: int = 90

    def __init__(self, name: str, window: FluentWindow, base_key: str) -> None:
        super().__init__(name, window)

        self.base_key: str = base_key
        self.rule_type: DataManager.RuleType = (
            DataManager.RuleType.PRE_REPLACEMENT
            if base_key == "pre_translation_replacement"
            else DataManager.RuleType.POST_REPLACEMENT
        )
        self.enable_meta_key: str = f"{base_key}_enable"
        self.PRESET_DIR_NAME: str = base_key
        self.DEFAULT_PRESET_CONFIG_KEY: str = f"{base_key}_default_preset"
        self.rule_icon_renderer = QualityRuleIconRenderer(
            icon_size=self.RULE_ICON_SIZE,
            inner_size=self.RULE_ICON_INNER_SIZE,
            border_width=self.RULE_ICON_BORDER_WIDTH,
            luma_threshold=self.RULE_ICON_LUMA_THRESHOLD,
            icon_spacing=self.RULE_ICON_SPACING,
        )

        self.QUALITY_RULE_TYPES = {self.rule_type.value}
        self.QUALITY_META_KEYS = {self.enable_meta_key}

        config = Config().load().save()

        self.add_widget_head(self.root, config, window)
        self.setup_split_body(self.root)
        self.setup_table_columns()
        self.setup_split_foot(self.root)
        self.add_command_bar_actions(config, window)

        qconfig.themeChanged.connect(self.on_theme_changed)
        self.destroyed.connect(self.disconnect_theme_signals)

        # 注册事件
        self.subscribe(Base.Event.QUALITY_RULE_UPDATE, self.on_quality_rule_update)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

    # ==================== DataManager 适配 ====================

    def load_entries(self) -> list[dict[str, Any]]:
        if self.base_key == "pre_translation_replacement":
            return DataManager.get().get_pre_replacement()
        return DataManager.get().get_post_replacement()

    def save_entries(self, entries: list[dict[str, Any]]) -> None:
        if self.base_key == "pre_translation_replacement":
            DataManager.get().set_pre_replacement(entries)
        else:
            DataManager.get().set_post_replacement(entries)

    def get_enable(self) -> bool:
        if self.base_key == "pre_translation_replacement":
            return DataManager.get().get_pre_replacement_enable()
        return DataManager.get().get_post_replacement_enable()

    def set_enable(self, enable: bool) -> None:
        if self.base_key == "pre_translation_replacement":
            DataManager.get().set_pre_replacement_enable(enable)
        else:
            DataManager.get().set_post_replacement_enable(enable)

    # ==================== SplitPageBase hooks ====================

    def create_edit_panel(self, parent) -> TextReplacementEditPanel:
        panel = TextReplacementEditPanel(parent)
        panel.add_requested.connect(
            lambda: self.run_with_unsaved_guard(self.add_entry_after_current)
        )
        panel.save_requested.connect(self.save_current_entry)
        panel.delete_requested.connect(self.delete_current_entry)
        return panel

    def create_empty_entry(self) -> dict[str, Any]:
        return {
            "src": "",
            "dst": "",
            "regex": False,
            "case_sensitive": False,
        }

    def get_list_headers(self) -> tuple[str, ...]:
        return (
            getattr(Localizer.get(), f"{self.base_key}_page_table_row_01"),
            getattr(Localizer.get(), f"{self.base_key}_page_table_row_02"),
            getattr(Localizer.get(), f"{self.base_key}_page_table_row_03"),
        )

    def get_row_values(self, entry: dict[str, Any]) -> tuple[str, ...]:
        return (
            str(entry.get("src", "")),
            str(entry.get("dst", "")),
            "",
        )

    def update_table_cell(
        self,
        row: int,
        col: int,
        entry: dict[str, Any] | None,
        editable: bool,
    ) -> bool:
        if col != self.RULE_COLUMN_INDEX:
            return False

        regex = False
        case_sensitive = False
        if entry is not None:
            regex = bool(entry.get("regex", False))
            case_sensitive = bool(entry.get("case_sensitive", False))
        self.update_rule_cell_item(row, regex, case_sensitive, editable)
        return True

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1)

    def validate_entry(self, entry: dict[str, Any]) -> tuple[bool, str]:
        if hasattr(self, "edit_panel"):
            self.edit_panel.set_src_error(False)

        src = str(entry.get("src", "")).strip()
        if not src:
            return True, ""

        if not bool(entry.get("regex", False)):
            return True, ""

        is_case_sensitive = bool(entry.get("case_sensitive", False))
        flags = 0 if is_case_sensitive else re.IGNORECASE
        try:
            re.compile(src, flags)
        except re.error as e:
            if hasattr(self, "edit_panel"):
                self.edit_panel.set_src_error(True)
            return False, f"{Localizer.get().search_regex_invalid}: {e}"

        return True, ""

    def on_entries_reloaded(self) -> None:
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(self.get_enable())
        if hasattr(self, "search_card"):
            self.search_card.reset_state()

    def on_project_unloaded_ui(self) -> None:
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(True)

    # ==================== UI：头部 ====================

    def add_widget_head(self, parent, config: Config, window: FluentWindow) -> None:
        del window

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(self.get_enable())

        def checked_changed(widget: SwitchButtonCard) -> None:
            self.set_enable(widget.get_switch_button().isChecked())

        self.switch_card = SwitchButtonCard(
            getattr(Localizer.get(), f"{self.base_key}_page_head_title"),
            getattr(Localizer.get(), f"{self.base_key}_page_head_content"),
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.switch_card)

    def setup_table_columns(self) -> None:
        header = cast(QHeaderView, self.table.horizontalHeader())
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(
            self.RULE_COLUMN_INDEX, QHeaderView.ResizeMode.Fixed
        )
        self.table.setColumnWidth(self.RULE_COLUMN_INDEX, self.RULE_COLUMN_WIDTH)
        self.table.setIconSize(QSize(self.RULE_ICON_SIZE, self.RULE_ICON_SIZE))
        self.table.setItemDelegate(
            QualityRuleIconDelegate(
                self.table,
                icon_column_index=self.RULE_COLUMN_INDEX,
                icon_size=self.RULE_ICON_SIZE,
            )
        )

    def disconnect_theme_signals(self) -> None:
        try:
            qconfig.themeChanged.disconnect(self.on_theme_changed)
        except (TypeError, RuntimeError):
            pass

    def on_theme_changed(self) -> None:
        self.rule_icon_renderer.clear_cache()
        self.refresh_table()

    def update_rule_cell_item(
        self, row: int, regex: bool, case_sensitive: bool, editable: bool
    ) -> None:
        item = self.table.item(row, self.RULE_COLUMN_INDEX)
        if item is None:
            item = QTableWidgetItem()
            self.table.setItem(row, self.RULE_COLUMN_INDEX, item)

        item.setText("")
        ui_font = getattr(self, "ui_font", None)
        if ui_font is not None:
            item.setFont(ui_font)
        item.setData(
            Qt.ItemDataRole.TextAlignmentRole,
            int(Qt.AlignmentFlag.AlignCenter),
        )

        if editable:
            item.setData(
                Qt.ItemDataRole.DecorationRole,
                self.rule_icon_renderer.get_pixmap(
                    self.table,
                    [
                        RuleIconSpec(FluentIcon.IOT, regex),
                        RuleIconSpec(FluentIcon.FONT, case_sensitive),
                    ],
                ),
            )
            item.setToolTip(self.build_rule_tooltip(regex, case_sensitive))
        else:
            item.setData(Qt.ItemDataRole.DecorationRole, None)
            item.setToolTip("")

        if editable:
            flags: Qt.ItemFlags = Qt.ItemFlags(Qt.ItemFlag.NoItemFlags)
            flags |= Qt.ItemFlag.ItemIsEnabled
            flags |= Qt.ItemFlag.ItemIsSelectable
            item.setFlags(flags)
        else:
            flags: Qt.ItemFlags = Qt.ItemFlags(Qt.ItemFlag.NoItemFlags)
            flags |= Qt.ItemFlag.ItemIsEnabled
            item.setFlags(flags)

    def build_rule_tooltip(self, regex: bool, case_sensitive: bool) -> str:
        regex_line = (
            Localizer.get().rule_regex_on if regex else Localizer.get().rule_regex_off
        )
        case_line = (
            Localizer.get().rule_case_sensitive_on
            if case_sensitive
            else Localizer.get().rule_case_sensitive_off
        )
        return (
            f"{Localizer.get().rule_regex}\n{regex_line}\n"
            f"{Localizer.get().rule_case_sensitive}\n{case_line}"
        )

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
