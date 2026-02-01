from typing import Any

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import qconfig

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Quality.GlossaryEditPanel import GlossaryEditPanel
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconDelegate
from frontend.Quality.QualityRuleIconHelper import QualityRuleIconRenderer
from frontend.Quality.QualityRuleIconHelper import RuleIconSpec
from frontend.Quality.QualityRulePageBase import QualityRulePageBase
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from widget.SwitchButtonCard import SwitchButtonCard


# ==================== 图标常量 ====================

ICON_CASE_SENSITIVE: BaseIcon = BaseIcon.CASE_SENSITIVE  # 规则图标：大小写敏感
ICON_MENU_DELETE: BaseIcon = BaseIcon.TRASH_2  # 右键菜单：删除条目
ICON_MENU_ENABLE: BaseIcon = BaseIcon.CHECK  # 右键菜单：启用
ICON_MENU_DISABLE: BaseIcon = BaseIcon.X  # 右键菜单：禁用
ICON_KG_LINK: BaseIcon = BaseIcon.BOT  # 命令栏：跳转 KeywordGacha


class GlossaryPage(QualityRulePageBase):
    PRESET_DIR_NAME: str = "glossary"
    DEFAULT_PRESET_CONFIG_KEY: str = "glossary_default_preset"
    SKIP_SUCCESS_TOAST_ON_MERGE: bool = True

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
        self.add_command_bar_actions(config, window)

        qconfig.themeChanged.connect(self.on_theme_changed)
        self.destroyed.connect(self.disconnect_theme_signals)

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

    def update_table_cell(
        self,
        row: int,
        col: int,
        entry: dict[str, Any] | None,
        editable: bool,
    ) -> bool:
        if col != self.CASE_COLUMN_INDEX:
            return False

        case_sensitive = False
        if entry is not None:
            case_sensitive = bool(entry.get("case_sensitive", False))
        self.update_case_cell_item(row, case_sensitive, editable)
        return True

    def on_entries_reloaded(self) -> None:
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(self.get_glossary_enable())
        if hasattr(self, "search_card"):
            self.search_card.reset_state()

    # ==================== 事件 ====================

    def delete_current_entry(self) -> None:
        if self.current_index < 0 or self.current_index >= len(self.entries):
            return
        self.delete_entries_by_rows([self.current_index])

    def on_project_unloaded_ui(self) -> None:
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(True)

    # ==================== UI：头部 ====================

    def add_widget_head(self, parent, config: Config, window: FluentWindow) -> None:
        del window

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(self.get_glossary_enable())

        def checked_changed(widget: SwitchButtonCard) -> None:
            self.set_glossary_enable(widget.get_switch_button().isChecked())

        self.switch_card = SwitchButtonCard(
            Localizer.get().app_glossary_page,
            Localizer.get().glossary_page_head_content,
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.switch_card)

    def setup_table_columns(self) -> None:
        self.table.setIconSize(QSize(self.CASE_ICON_SIZE, self.CASE_ICON_SIZE))
        self.table.setItemDelegate(
            QualityRuleIconDelegate(
                self.table,
                icon_column_index=self.CASE_COLUMN_INDEX,
                icon_size=self.CASE_ICON_SIZE,
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
        self.table.setColumnWidth(self.CASE_COLUMN_INDEX, self.CASE_COLUMN_WIDTH)

        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self.on_table_context_menu)

    def disconnect_theme_signals(self) -> None:
        try:
            qconfig.themeChanged.disconnect(self.on_theme_changed)
        except (TypeError, RuntimeError):
            pass

    def on_theme_changed(self) -> None:
        self.rule_icon_renderer.clear_cache()
        self.refresh_table()

    def get_case_tooltip(self, case_sensitive: bool) -> str:
        return (
            f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().status_enabled}"
            if case_sensitive
            else f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().status_disabled}"
        )

    def update_case_cell_item(
        self, row: int, case_sensitive: bool, editable: bool
    ) -> None:
        item = self.table.item(row, self.CASE_COLUMN_INDEX)
        if item is None:
            item = QTableWidgetItem()
            self.table.setItem(row, self.CASE_COLUMN_INDEX, item)

        item.setText("")
        item.setFont(self.ui_font)
        item.setData(
            Qt.ItemDataRole.TextAlignmentRole,
            int(Qt.AlignmentFlag.AlignCenter),
        )

        if editable:
            item.setData(
                Qt.ItemDataRole.DecorationRole,
                self.rule_icon_renderer.get_pixmap(
                    self.table,
                    [RuleIconSpec(ICON_CASE_SENSITIVE, case_sensitive)],
                ),
            )
            item.setToolTip(self.get_case_tooltip(case_sensitive))
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
                ICON_MENU_DELETE,
                Localizer.get().delete,
                triggered=lambda: self.run_with_unsaved_guard(
                    self.delete_selected_entries
                ),
            )
        )
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
                    "message": Localizer.get().toast_save,
                },
            )

        if self.reload_pending:
            self.reload_entries()

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
            self.error("Failed to save rules", e)
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
        self.add_command_bar_action_kg()
        self.add_command_bar_action_wiki()

    def add_command_bar_action_kg(self) -> None:
        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/KeywordGacha"))

        push_button = TransparentPushButton(
            ICON_KG_LINK,
            Localizer.get().glossary_page_kg,
        )
        push_button.clicked.connect(connect)
        self.command_bar_card.add_widget(push_button)
