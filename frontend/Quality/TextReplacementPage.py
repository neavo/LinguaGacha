import re
from typing import Any
from typing import cast

from PySide6.QtCore import QPoint
from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHeaderView
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import qconfig

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconDelegate
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconRenderer
from frontend.Quality.QualityRuleIconHelper import RuleIconSpec
from frontend.Quality.QualityRulePageBase import QualityRulePageBase
from frontend.Quality.TextReplacementEditPanel import TextReplacementEditPanel
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from widget.AppTable import ColumnSpec
from widget.SwitchButtonCard import SwitchButtonCard


# ==================== 图标常量 ====================

ICON_MENU_DELETE: BaseIcon = BaseIcon.TRASH_2  # 右键菜单：删除条目
ICON_RULE_REGEX: BaseIcon = BaseIcon.REGEX  # 规则图标：正则
ICON_RULE_CASE_SENSITIVE: BaseIcon = BaseIcon.CASE_SENSITIVE  # 规则图标：大小写敏感
ICON_MENU_ENABLE: BaseIcon = BaseIcon.CHECK  # 右键菜单：启用
ICON_MENU_DISABLE: BaseIcon = BaseIcon.X  # 右键菜单：禁用


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
            Localizer.get().table_col_source,
            Localizer.get().table_col_replacement,
            Localizer.get().table_col_rule,
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
        del row
        del col
        del entry
        del editable
        return False

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1)

    def get_column_specs(self) -> list[ColumnSpec[dict[str, Any]]]:
        specs = super().get_column_specs()
        if self.RULE_COLUMN_INDEX < 0 or self.RULE_COLUMN_INDEX >= len(specs):
            return specs

        header = specs[self.RULE_COLUMN_INDEX].header

        def get_regex(row: dict[str, Any]) -> bool:
            return bool(row.get("regex", False))

        def get_case_sensitive(row: dict[str, Any]) -> bool:
            return bool(row.get("case_sensitive", False))

        specs[self.RULE_COLUMN_INDEX] = ColumnSpec(
            header=header,
            width_mode=ColumnSpec.WidthMode.FIXED,
            width=self.RULE_COLUMN_WIDTH,
            alignment=Qt.AlignmentFlag.AlignCenter,
            display_getter=lambda row: "",
            decoration_getter=lambda row: self.rule_icon_renderer.get_pixmap(
                self.table,
                [
                    RuleIconSpec(ICON_RULE_REGEX, get_regex(row)),
                    RuleIconSpec(
                        ICON_RULE_CASE_SENSITIVE,
                        get_case_sensitive(row),
                    ),
                ],
            ),
            tooltip_getter=lambda row: self.build_rule_tooltip(
                get_regex(row),
                get_case_sensitive(row),
            ),
        )
        return specs

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
                icon_count=2,
                on_icon_clicked=self.on_rule_icon_clicked,
            )
        )

        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.on_table_context_menu)

    def on_rule_icon_clicked(self, row: int, icon_index: int) -> None:
        if row < 0 or row >= len(self.entries):
            return

        if icon_index == 0:
            enabled = not bool(self.entries[row].get("regex", False))
            self.run_with_unsaved_guard(lambda: self.set_regex_for_rows([row], enabled))
            return

        if icon_index == 1:
            enabled = not bool(self.entries[row].get("case_sensitive", False))
            self.run_with_unsaved_guard(
                lambda: self.set_case_sensitive_for_rows([row], enabled)
            )
            return

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
        menu.addSeparator()

        regex_menu = RoundMenu(Localizer.get().rule_regex, menu)
        regex_menu.setIcon(ICON_RULE_REGEX)
        regex_menu.addAction(
            Action(
                ICON_MENU_ENABLE,
                Localizer.get().enable,
                triggered=lambda: self.run_with_unsaved_guard(
                    lambda: self.set_regex_for_selection(True)
                ),
            )
        )
        regex_menu.addAction(
            Action(
                ICON_MENU_DISABLE,
                Localizer.get().disable,
                triggered=lambda: self.run_with_unsaved_guard(
                    lambda: self.set_regex_for_selection(False)
                ),
            )
        )
        menu.addMenu(regex_menu)

        case_menu = RoundMenu(Localizer.get().rule_case_sensitive, menu)
        case_menu.setIcon(ICON_RULE_CASE_SENSITIVE)
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
            LogManager.get().error(Localizer.get().task_failed, e)
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
                "message": Localizer.get().toast_save,
            },
        )

        if self.reload_pending:
            self.reload_entries()

    def set_regex_for_rows(self, rows: list[int], enabled: bool) -> None:
        if not rows:
            return

        changed_rows: list[int] = []
        for row in rows:
            if row < 0 or row >= len(self.entries):
                continue
            current_value = bool(self.entries[row].get("regex", False))
            if current_value == enabled:
                continue
            self.entries[row]["regex"] = enabled
            changed_rows.append(row)

        if not changed_rows:
            return

        try:
            self.save_entries(self.entries)
            # 避免自身保存触发的 QUALITY_RULE_UPDATE 重载。
            self.ignore_next_quality_rule_update = True
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            return

        self.table.blockSignals(True)
        self.table.setUpdatesEnabled(False)
        for row in sorted(set(changed_rows)):
            self.refresh_table_row(row)
        self.table.setUpdatesEnabled(True)
        self.table.blockSignals(False)

        if self.current_index in changed_rows and 0 <= self.current_index < len(
            self.entries
        ):
            self.edit_panel.bind_entry(
                self.entries[self.current_index], self.current_index + 1
            )

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().toast_save,
            },
        )

        if self.reload_pending:
            self.reload_entries()

    def set_regex_for_selection(self, enabled: bool) -> None:
        self.set_regex_for_rows(self.get_selected_entry_rows(), enabled)

    def set_case_sensitive_for_rows(self, rows: list[int], enabled: bool) -> None:
        if not rows:
            return

        changed_rows: list[int] = []
        for row in rows:
            if row < 0 or row >= len(self.entries):
                continue
            current_value = bool(self.entries[row].get("case_sensitive", False))
            if current_value == enabled:
                continue
            self.entries[row]["case_sensitive"] = enabled
            changed_rows.append(row)

        if not changed_rows:
            return

        try:
            self.save_entries(self.entries)
            # 避免自身保存触发的 QUALITY_RULE_UPDATE 重载。
            self.ignore_next_quality_rule_update = True
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            return

        self.table.blockSignals(True)
        self.table.setUpdatesEnabled(False)
        for row in sorted(set(changed_rows)):
            self.refresh_table_row(row)
        self.table.setUpdatesEnabled(True)
        self.table.blockSignals(False)

        if self.current_index in changed_rows and 0 <= self.current_index < len(
            self.entries
        ):
            self.edit_panel.bind_entry(
                self.entries[self.current_index], self.current_index + 1
            )

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().toast_save,
            },
        )

        if self.reload_pending:
            self.reload_entries()

    def set_case_sensitive_for_selection(self, enabled: bool) -> None:
        self.set_case_sensitive_for_rows(self.get_selected_entry_rows(), enabled)

    def disconnect_theme_signals(self) -> None:
        try:
            qconfig.themeChanged.disconnect(self.on_theme_changed)
        except TypeError, RuntimeError:
            # Qt 对象销毁或重复断开连接时可能抛异常，可忽略。
            pass

    def on_theme_changed(self) -> None:
        self.rule_icon_renderer.clear_cache()
        self.refresh_table()

    def build_rule_tooltip(self, regex: bool, case_sensitive: bool) -> str:
        regex_line = (
            Localizer.get().status_enabled if regex else Localizer.get().status_disabled
        )
        case_line = (
            Localizer.get().status_enabled
            if case_sensitive
            else Localizer.get().status_disabled
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
