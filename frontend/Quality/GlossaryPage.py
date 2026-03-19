from typing import Any

from PySide6.QtCore import QPoint
from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHeaderView
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import RoundMenu
from qfluentwidgets import qconfig

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Quality.GlossaryEditPanel import GlossaryEditPanel
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconDelegate
from frontend.Quality.QualityRuleIconHelper import IconColumnConfig
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconRenderer
from frontend.Quality.QualityRuleIconHelper import RuleIconSpec
from frontend.Quality.QualityRulePageBase import QualityRulePageBase
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics
from qfluentwidgets import SwitchButton
from widget.AppTable.ColumnSpec import ColumnSpec
from widget.SettingCard import SettingCard


# ==================== 图标常量 ====================

ICON_CASE_SENSITIVE: BaseIcon = BaseIcon.CASE_SENSITIVE  # 规则图标：大小写敏感
ICON_MENU_DELETE: BaseIcon = BaseIcon.TRASH_2  # 右键菜单：删除条目
ICON_MENU_ENABLE: BaseIcon = BaseIcon.CHECK  # 右键菜单：启用
ICON_MENU_DISABLE: BaseIcon = BaseIcon.X  # 右键菜单：禁用


class GlossaryPage(QualityRulePageBase):
    PRESET_DIR_NAME: str = "glossary"
    DEFAULT_PRESET_CONFIG_KEY: str = "glossary_default_preset"

    CASE_COLUMN_INDEX: int = 3
    CASE_COLUMN_WIDTH: int = 80
    CASE_ICON_SIZE: int = 24
    CASE_ICON_INNER_SIZE: int = 12
    CASE_ICON_BORDER_WIDTH: int = 1
    CASE_ICON_LUMA_THRESHOLD: float = 0.75
    CASE_ICON_SPACING: int = 4

    QUALITY_RULE_TYPES: set[str] = {DataManager.RuleType.GLOSSARY.value}
    QUALITY_META_KEYS: set[str] = {"glossary_enable"}

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(text, window)

        self.rule_icon_renderer = QualityRuleIconRenderer(
            icon_size=self.CASE_ICON_SIZE,
            inner_size=self.CASE_ICON_INNER_SIZE,
            border_width=self.CASE_ICON_BORDER_WIDTH,
            luma_threshold=self.CASE_ICON_LUMA_THRESHOLD,
            icon_spacing=self.CASE_ICON_SPACING,
        )

        # 载入并保存默认配置
        config = Config().load().save()

        self.add_widget_head(self.root, config, window)
        self.setup_split_body(self.root)
        self.setup_table_columns()
        self.setup_split_foot(self.root)
        self.add_standard_command_bar_actions(
            config,
            window,
        )

        qconfig.themeChanged.connect(self.on_theme_changed)
        self.destroyed.connect(
            lambda: self.disconnect_theme_changed_signal(self.on_theme_changed)
        )

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

    def create_edit_panel(self, parent: QWidget) -> GlossaryEditPanel:
        return self.bind_edit_panel_actions(GlossaryEditPanel(parent))

    def create_empty_entry(self) -> dict[str, Any]:
        return {
            "src": "",
            "dst": "",
            "info": "",
            "case_sensitive": False,
        }

    def get_list_headers(self) -> tuple[str, ...]:
        return (
            Localizer.get().table_col_source,
            Localizer.get().table_col_translation,
            Localizer.get().glossary_page_table_row_04,
            Localizer.get().table_col_rule,
        )

    def get_row_values(self, entry: dict[str, Any]) -> tuple[str, ...]:
        # 规则列使用图标展示，不需要文本
        return (
            str(entry.get("src", "")),
            str(entry.get("dst", "")),
            str(entry.get("info", "")),
            "",
        )

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1, 2)

    def build_statistics_entry_key(self, entry: dict[str, Any]) -> str:
        return QualityRuleStatistics.build_glossary_rule_stat_key(entry)

    def build_statistics_inputs(
        self, entries: list[dict[str, Any]] | None = None
    ) -> list[QualityRuleStatistics.RuleStatInput]:
        entries_source = self.entries if entries is None else entries
        return QualityRuleStatistics.build_glossary_rule_stat_inputs(entries_source)

    def get_column_specs(self) -> list[ColumnSpec[dict[str, Any]]]:
        specs = super().get_column_specs()
        if self.CASE_COLUMN_INDEX < 0 or self.CASE_COLUMN_INDEX >= len(specs):
            return specs

        header = specs[self.CASE_COLUMN_INDEX].header

        def get_case_sensitive(row: dict[str, Any]) -> bool:
            return bool(row.get("case_sensitive", False))

        specs[self.CASE_COLUMN_INDEX] = ColumnSpec(
            header=header,
            width_mode=ColumnSpec.WidthMode.FIXED,
            width=self.CASE_COLUMN_WIDTH,
            alignment=Qt.AlignmentFlag.AlignCenter,
            display_getter=lambda row: "",
            decoration_getter=lambda row: self.rule_icon_renderer.get_pixmap(
                self.table,
                [RuleIconSpec(ICON_CASE_SENSITIVE, get_case_sensitive(row))],
            ),
            tooltip_getter=lambda row: self.get_case_tooltip(get_case_sensitive(row)),
        )
        return specs

    def on_entries_reloaded(self) -> None:
        if hasattr(self, "glossary_switch") and self.glossary_switch is not None:
            self.glossary_switch.setChecked(self.get_glossary_enable())
        if hasattr(self, "search_card"):
            self.search_card.reset_state()

    # ==================== 事件 ====================

    def delete_current_entry(self) -> None:
        if self.current_index < 0 or self.current_index >= len(self.entries):
            return
        self.delete_entries_by_rows([self.current_index])

    def on_project_unloaded_ui(self) -> None:
        if hasattr(self, "glossary_switch") and self.glossary_switch is not None:
            self.glossary_switch.setChecked(True)

    # ==================== UI：头部 ====================

    def add_widget_head(self, parent, config: Config, window: FluentWindow) -> None:
        del window

        def checked_changed(button: SwitchButton) -> None:
            self.set_glossary_enable(button.isChecked())

        card = SettingCard(
            Localizer.get().app_glossary_page,
            Localizer.get().glossary_page_head_content,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(self.get_glossary_enable())
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        self.glossary_switch = switch_button
        parent.addWidget(card)

    def setup_table_columns(self) -> None:
        self.table.setIconSize(QSize(self.CASE_ICON_SIZE, self.CASE_ICON_SIZE))
        self.table.setItemDelegate(
            QualityRuleIconDelegate(
                self.table,
                icon_column_index=self.CASE_COLUMN_INDEX,
                icon_size=self.CASE_ICON_SIZE,
                icon_column_configs=[
                    IconColumnConfig(
                        column_index=self.CASE_COLUMN_INDEX,
                        icon_count=1,
                        on_icon_clicked=self.on_rule_icon_clicked,
                    ),
                    IconColumnConfig(
                        column_index=self.statistics_column_index,
                        icon_count=2,
                        icon_tooltip_getter=self.get_statistics_icon_tooltip_by_source_row,
                    ),
                ],
            )
        )
        header = self.table.horizontalHeader()
        if header is not None:
            header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(
                self.CASE_COLUMN_INDEX, QHeaderView.ResizeMode.Fixed
            )
            header.setSectionResizeMode(
                self.statistics_column_index, QHeaderView.ResizeMode.Fixed
            )
        self.table.setColumnWidth(self.CASE_COLUMN_INDEX, self.CASE_COLUMN_WIDTH)
        self.table.setColumnWidth(
            self.statistics_column_index,
            self.STATISTICS_COLUMN_WIDTH,
        )

        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.on_table_context_menu)

    def on_rule_icon_clicked(self, row: int, icon_index: int) -> None:
        del icon_index
        if row < 0 or row >= len(self.entries):
            return

        enabled = not bool(self.entries[row].get("case_sensitive", False))
        self.run_with_unsaved_guard(
            lambda: self.set_case_sensitive_for_rows([row], enabled)
        )

    def on_theme_changed(self) -> None:
        self.rule_icon_renderer.clear_cache()
        self.refresh_table()

    def get_case_tooltip(self, case_sensitive: bool) -> str:
        return (
            f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().status_enabled}"
            if case_sensitive
            else f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().status_disabled}"
        )

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
        menu.addSeparator()

        case_menu = RoundMenu(Localizer.get().rule_case_sensitive, menu)
        case_menu.setIcon(ICON_CASE_SENSITIVE)
        case_menu.addAction(
            Action(
                ICON_MENU_ENABLE,
                Localizer.get().enable,
                triggered=lambda: self.run_with_unsaved_guard(
                    lambda: self.set_case_sensitive_for_selection(True)
                ),
            )
        )
        case_menu.addAction(
            Action(
                ICON_MENU_DISABLE,
                Localizer.get().disable,
                triggered=lambda: self.run_with_unsaved_guard(
                    lambda: self.set_case_sensitive_for_selection(False)
                ),
            )
        )
        menu.addMenu(case_menu)

        viewport = self.table.viewport()
        if viewport is None:
            return
        menu.exec(viewport.mapToGlobal(position))

    def delete_entries_by_rows(self, rows: list[int]) -> None:
        self.delete_entries_by_rows_common(
            rows,
            emit_success_toast_when_empty=True,
        )

    def set_case_sensitive_for_rows(self, rows: list[int], enabled: bool) -> None:
        self.set_boolean_field_for_rows(
            rows,
            field_name="case_sensitive",
            enabled=enabled,
            default_value=False,
        )

    def set_case_sensitive_for_selection(self, enabled: bool) -> None:
        self.set_case_sensitive_for_rows(self.get_selected_entry_rows(), enabled)
