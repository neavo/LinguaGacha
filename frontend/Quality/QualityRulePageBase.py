from pathlib import Path
from typing import Any
from typing import Callable
from typing import cast

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QBoxLayout
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import TableWidget
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import getFont
from qfluentwidgets import setCustomStyleSheet
from qfluentwidgets.components.widgets.command_bar import CommandButton

from base.Base import Base
from frontend.Quality.QualityRulePresetManager import QualityRulePresetManager
from module.Config import Config
from module.Data.QualityRuleIO import QualityRuleIO
from module.Data.QualityRuleMerge import QualityRuleMerge
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard


class QualityRulePageBase(QWidget, Base):
    """质量规则页的复合布局基类。

    约束：
    - 左侧列表只读；右侧编辑区维护 dirty 状态
    - 触发选中/搜索跳转等动作前，统一走 run_with_unsaved_guard() 自动保存
    """

    # 子类需要覆盖：用于 QUALITY_RULE_UPDATE 过滤
    QUALITY_RULE_TYPES: set[str] = set()
    QUALITY_META_KEYS: set[str] = set()

    # 子类可覆盖：预设目录名、默认预设配置键
    PRESET_DIR_NAME: str = ""
    DEFAULT_PRESET_CONFIG_KEY: str = ""

    # 子类可覆盖：合并提示时是否仍显示保存成功
    SKIP_SUCCESS_TOAST_ON_MERGE: bool = False

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        self.main_window = window

        self.entries: list[dict[str, Any]] = []
        self.current_index: int = -1
        self.block_selection_change: bool = False
        self.pending_action: Callable[[], None] | None = None
        self.pending_revert: Callable[[], None] | None = None
        self.reload_pending: bool = False
        self.ignore_next_quality_rule_update: bool = False
        self.preset_manager: QualityRulePresetManager | None = None

        self.equal_width_columns: tuple[int, ...] | None = None
        self.equal_reserved_width: int = 0
        self.equal_min_width: int = 0
        self.auto_resizing_columns: bool = False
        self.user_resized_columns: bool = False
        self.initial_column_sync_done: bool = False

        # 主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

    # ==================== 子类需要实现的最小接口 ====================

    def load_entries(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def save_entries(self, entries: list[dict[str, Any]]) -> None:
        raise NotImplementedError

    def create_edit_panel(self, parent: QWidget) -> QWidget:
        raise NotImplementedError

    def get_list_headers(self) -> tuple[str, ...]:
        raise NotImplementedError

    def get_row_values(self, entry: dict[str, Any]) -> tuple[str, ...]:
        raise NotImplementedError

    def get_search_columns(self) -> tuple[int, ...]:
        raise NotImplementedError

    def create_empty_entry(self) -> dict[str, Any]:
        raise NotImplementedError

    def update_table_cell(
        self,
        row: int,
        col: int,
        entry: dict[str, Any] | None,
        editable: bool,
    ) -> bool:
        return False

    def validate_entry(self, entry: dict[str, Any]) -> tuple[bool, str]:
        return True, ""

    def on_entries_reloaded(self) -> None:
        """子类可覆盖：用于同步头部开关/模式等 UI。"""

    # ==================== UI 组装（供子类调用） ====================

    def setup_split_body(self, parent: QBoxLayout) -> None:
        body_widget = QWidget(self)
        body_layout = QHBoxLayout(body_widget)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(8)

        self.table = TableWidget(body_widget)
        self.table.setBorderVisible(False)
        self.table.setSelectRightClickedRow(True)
        self.table.setAlternatingRowColors(True)
        self.table.setColumnCount(len(self.get_list_headers()))
        self.table.setHorizontalHeaderLabels(self.get_list_headers())

        v_header = cast(QHeaderView, self.table.verticalHeader())
        v_header.setVisible(True)
        v_header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        v_header.setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        # 左侧列表只读
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.itemSelectionChanged.connect(self.on_table_selection_changed)

        self.setup_table_style()

        self.edit_panel = self.create_edit_panel(body_widget)

        body_layout.addWidget(self.table, 7)
        body_layout.addWidget(self.edit_panel, 3)
        parent.addWidget(body_widget)

    def setup_split_foot(self, parent: QBoxLayout) -> None:
        # 搜索栏（默认隐藏）
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        # 命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.search_card.set_base_font(self.command_bar_card.command_bar.font())

        def notify(level: str, message: str) -> None:
            type_map = {
                "error": Base.ToastType.ERROR,
                "warning": Base.ToastType.WARNING,
                "info": Base.ToastType.INFO,
            }
            self.emit(
                Base.Event.TOAST,
                {
                    "type": type_map.get(level, Base.ToastType.INFO),
                    "message": message,
                },
            )

        self.search_card.bind_table(self.table, self.get_search_columns(), notify)

        self.search_card.on_back_clicked(lambda w: self.on_search_back_clicked())
        self.search_card.on_prev_clicked(lambda w: self.on_search_prev_clicked())
        self.search_card.on_next_clicked(lambda w: self.on_search_next_clicked())
        self.search_card.on_search_triggered(lambda w: self.on_search_triggered())
        self.search_card.on_search_mode_changed(lambda w: self.on_search_mode_changed())

    def setup_table_style(self) -> None:
        self.ui_font = getFont(12)
        self.ui_font.setHintingPreference(self.table.font().hintingPreference())
        header_qss = "QHeaderView::section {\n    font: 12px --FontFamilies;\n}\n"
        setCustomStyleSheet(self.table, header_qss, header_qss)
        self.table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.table.setWordWrap(False)
        self.table.setTextElideMode(Qt.TextElideMode.ElideRight)

        header = cast(QHeaderView, self.table.horizontalHeader())
        header.setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        header.setStretchLastSection(False)

    def on_header_section_resized(
        self, logical_index: int, old_size: int, new_size: int
    ) -> None:
        del logical_index
        del old_size
        del new_size
        if self.auto_resizing_columns:
            return
        if not self.initial_column_sync_done:
            return
        self.user_resized_columns = True

    def schedule_equal_column_widths(
        self,
        columns: tuple[int, ...],
        reserved_width: int = 0,
        min_width: int = 0,
    ) -> None:
        self.equal_width_columns = columns
        self.equal_reserved_width = reserved_width
        self.equal_min_width = min_width
        self.user_resized_columns = False
        self.initial_column_sync_done = False
        QTimer.singleShot(0, self.apply_equal_column_widths)

    def apply_equal_column_widths(self) -> None:
        if self.user_resized_columns:
            return
        if not self.equal_width_columns:
            return

        viewport = self.table.viewport()
        if viewport is None:
            return
        viewport_width = viewport.width()
        if viewport_width <= 0:
            return

        available = max(0, viewport_width - self.equal_reserved_width)
        if available <= 0:
            return

        base_width = max(1, available // len(self.equal_width_columns))
        if self.equal_min_width > 0:
            desired = max(base_width, self.equal_min_width)
            if desired * len(self.equal_width_columns) <= available:
                base_width = desired

        remainder = max(0, available - base_width * len(self.equal_width_columns))
        self.auto_resizing_columns = True
        for index, column in enumerate(self.equal_width_columns):
            extra = 1 if index < remainder else 0
            self.table.setColumnWidth(column, base_width + extra)
        self.auto_resizing_columns = False
        self.initial_column_sync_done = True

    def resizeEvent(self, a0) -> None:
        super().resizeEvent(a0)
        self.apply_equal_column_widths()

    # ==================== 事件处理 ====================

    def is_quality_rule_update_relevant(self, data: dict) -> bool:
        if not data:
            return True
        rule_types: list[str] = data.get("rule_types", [])
        meta_keys: list[str] = data.get("meta_keys", [])
        if any(rule_type in self.QUALITY_RULE_TYPES for rule_type in rule_types):
            return True
        return any(meta_key in self.QUALITY_META_KEYS for meta_key in meta_keys)

    def request_reload(self) -> None:
        if self.edit_panel.has_unsaved_changes():
            self.reload_pending = True
            return
        self.reload_entries()

    def on_quality_rule_update(self, event: Base.Event, data: dict) -> None:
        del event
        if not self.is_quality_rule_update_relevant(data):
            return
        if self.ignore_next_quality_rule_update:
            self.ignore_next_quality_rule_update = False
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
        if hasattr(self, "search_card"):
            self.search_card.reset_state()
            self.search_card.setVisible(False)
        if hasattr(self, "command_bar_card"):
            self.command_bar_card.setVisible(True)
        self.on_project_unloaded_ui()

    def on_project_unloaded_ui(self) -> None:
        """子类可覆盖：卸载工程时刷新头部 UI。"""
        return

    def reload_entries(self) -> None:
        # reload 过程中尽量保持当前选中行不跳回首行：
        # QUALITY_RULE_UPDATE 事件可能由“保存当前项”触发，如果这里固定 select_row(0)
        # 会导致用户编辑后列表焦点回到第一条。
        anchor_src = ""
        anchor_index = self.current_index
        if 0 <= self.current_index < len(self.entries):
            anchor_src = str(self.entries[self.current_index].get("src", "")).strip()

        self.entries = [v for v in self.load_entries() if isinstance(v, dict)]
        self.cleanup_empty_entries()
        self.refresh_table()
        self.on_entries_reloaded()
        self.reload_pending = False

        if not self.entries:
            self.apply_selection(-1)
            return

        if anchor_src:
            for i, v in enumerate(self.entries):
                if str(v.get("src", "")).strip() == anchor_src:
                    self.select_row(i)
                    return

        if anchor_index >= 0:
            self.select_row(min(anchor_index, len(self.entries) - 1))
            return

        self.select_row(0)

    # ==================== 列表渲染/选择 ====================

    def refresh_table(self) -> None:
        self.table.blockSignals(True)
        self.table.setUpdatesEnabled(False)

        headers = self.get_list_headers()
        col_count = len(headers)
        self.table.setColumnCount(col_count)
        self.table.setHorizontalHeaderLabels(headers)

        target_count = max(20, len(self.entries))
        self.table.setRowCount(target_count)

        for row in range(target_count):
            values = ("",) * col_count
            editable = False

            if row < len(self.entries):
                values = self.get_row_values(self.entries[row])
                editable = True
                entry = self.entries[row]
            else:
                entry = None

            for col in range(col_count):
                if self.update_table_cell(row, col, entry, editable):
                    continue
                item = self.table.item(row, col)
                if item is None:
                    item = QTableWidgetItem()
                    self.table.setItem(row, col, item)

                item.setText(values[col] if col < len(values) else "")
                ui_font = getattr(self, "ui_font", None)
                if ui_font is not None:
                    item.setFont(ui_font)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                if editable:
                    flags = item.flags()
                    flags |= Qt.ItemFlag.ItemIsEnabled
                    flags |= Qt.ItemFlag.ItemIsSelectable
                    flags &= ~Qt.ItemFlag.ItemIsEditable
                    item.setFlags(flags)
                else:
                    # 空白行保持样式铺满，但不允许选中。
                    flags = item.flags()
                    flags |= Qt.ItemFlag.ItemIsEnabled
                    flags &= ~Qt.ItemFlag.ItemIsSelectable
                    flags &= ~Qt.ItemFlag.ItemIsEditable
                    item.setFlags(flags)

        self.table.setUpdatesEnabled(True)
        self.table.blockSignals(False)

    def refresh_table_row(self, row: int) -> None:
        """仅刷新单行，避免保存时全量刷新。"""
        if row < 0 or row >= self.table.rowCount():
            return

        col_count = self.table.columnCount()
        values = ("",) * col_count
        editable = False

        if row < len(self.entries):
            values = self.get_row_values(self.entries[row])
            editable = True
            entry = self.entries[row]
        else:
            entry = None

        for col in range(col_count):
            if self.update_table_cell(row, col, entry, editable):
                continue
            item = self.table.item(row, col)
            if item is None:
                item = QTableWidgetItem()
                self.table.setItem(row, col, item)

            item.setText(values[col] if col < len(values) else "")
            ui_font = getattr(self, "ui_font", None)
            if ui_font is not None:
                item.setFont(ui_font)
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            if editable:
                flags = item.flags()
                flags |= Qt.ItemFlag.ItemIsEnabled
                flags |= Qt.ItemFlag.ItemIsSelectable
                flags &= ~Qt.ItemFlag.ItemIsEditable
                item.setFlags(flags)
            else:
                # 空白行保持样式铺满，但不允许选中。
                flags = item.flags()
                flags |= Qt.ItemFlag.ItemIsEnabled
                flags &= ~Qt.ItemFlag.ItemIsSelectable
                flags &= ~Qt.ItemFlag.ItemIsEditable
                item.setFlags(flags)

    def select_row(self, row: int) -> None:
        if row < 0 or row >= len(self.entries):
            self.table.clearSelection()
            self.apply_selection(-1)
            return

        self.block_selection_change = True
        self.table.selectRow(row)
        self.block_selection_change = False
        self.apply_selection(row)

    def on_table_selection_changed(self) -> None:
        if self.block_selection_change:
            return

        row = self.table.currentRow()
        if row < 0 or row >= len(self.entries):
            self.apply_selection(-1)
            return

        if row == self.current_index:
            return

        def action() -> None:
            self.apply_selection(row)

        def revert() -> None:
            if self.current_index < 0:
                return
            self.block_selection_change = True
            self.table.selectRow(self.current_index)
            self.block_selection_change = False

        self.run_with_unsaved_guard(action, revert)

    def apply_selection(self, row: int) -> None:
        self.current_index = row
        if row < 0 or row >= len(self.entries):
            self.edit_panel.clear()
            return
        self.edit_panel.bind_entry(self.entries[row], row + 1)

    def add_entry_after_current(self) -> None:
        insert_index = (
            self.current_index + 1
            if 0 <= self.current_index < len(self.entries)
            else len(self.entries)
        )
        self.entries.insert(insert_index, self.create_empty_entry())
        self.refresh_table()
        self.select_row(insert_index)

    # ==================== Unsaved Guard ====================

    def run_with_unsaved_guard(
        self, action: Callable[[], None], on_cancel: Callable[[], None] | None = None
    ) -> None:
        if not self.edit_panel.has_unsaved_changes():
            self.discard_empty_current_entry_if_needed()
            action()
            return

        self.pending_action = action
        self.pending_revert = on_cancel
        self.save_current_entry()

    def discard_empty_current_entry_if_needed(self) -> None:
        if self.current_index < 0 or self.current_index >= len(self.entries):
            return

        entry = self.entries[self.current_index]
        src = str(entry.get("src", "")).strip()
        if src:
            return

        # 旧表格编辑模式下，空 src 行不会被写入数据。这里对齐该行为：自动丢弃。
        del self.entries[self.current_index]
        self.current_index = -1
        self.save_entries(self.entries)
        self.refresh_table()

    def save_current_entry(self) -> None:
        # 无选中项时，在末尾插入新条目
        if self.current_index < 0 or self.current_index >= len(self.entries):
            entry = self.edit_panel.get_current_entry()
            src = str(entry.get("src", "")).strip()
            if not src:
                # 空 src 不创建条目
                return

            self.entries.append(entry)
            self.current_index = len(self.entries) - 1

        entry = self.edit_panel.get_current_entry()
        ok, error_msg = self.validate_entry(entry)
        if not ok:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": error_msg,
                },
            )

            if self.pending_revert:
                self.pending_revert()
            self.pending_action = None
            self.pending_revert = None
            return

        before_count = len(self.entries)
        merged, merge_toast = self.commit_entry(entry)
        try:
            self.cleanup_empty_entries()
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
            if self.pending_revert:
                self.pending_revert()
            self.pending_action = None
            self.pending_revert = None
            return

        after_count = len(self.entries)
        needs_full_refresh = merged or after_count != before_count

        if needs_full_refresh:
            # 结构性变化会影响行数与占位行，直接全量刷新更稳妥。
            self.refresh_table()
            if self.current_index >= 0 and self.current_index < len(self.entries):
                self.select_row(self.current_index)
            else:
                self.table.clearSelection()
                self.apply_selection(-1)
        else:
            # 常见路径：只更新当前行内容，避免整表重绘。
            self.table.blockSignals(True)
            self.table.setUpdatesEnabled(False)
            self.refresh_table_row(self.current_index)
            self.table.setUpdatesEnabled(True)
            self.table.blockSignals(False)

            if self.current_index >= 0 and self.current_index < len(self.entries):
                self.block_selection_change = True
                self.table.selectRow(self.current_index)
                self.block_selection_change = False
                self.edit_panel.bind_entry(
                    self.entries[self.current_index], self.current_index + 1
                )
            else:
                self.table.clearSelection()
                self.apply_selection(-1)

        if merged and merge_toast:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": merge_toast,
                },
            )

        if not merged or not self.SKIP_SUCCESS_TOAST_ON_MERGE:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().toast_save,
                },
            )

        action = self.pending_action
        self.pending_action = None
        self.pending_revert = None
        if callable(action):
            action()

        if self.reload_pending:
            self.reload_entries()

    def delete_current_entry(self) -> None:
        if self.current_index < 0 or self.current_index >= len(self.entries):
            return

        deleted_index = self.current_index
        del self.entries[self.current_index]
        self.current_index = -1

        try:
            self.cleanup_empty_entries()
            self.save_entries(self.entries)
            # 避免自身保存触发的 QUALITY_RULE_UPDATE 重载。
            self.ignore_next_quality_rule_update = True
        except Exception as e:
            self.error("Failed to delete rule", e)
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
            self.select_row(min(deleted_index, len(self.entries) - 1))
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

    def commit_entry(self, entry: dict[str, Any]) -> tuple[bool, str]:
        """提交当前编辑项到 entries。

        返回 (是否发生合并, 合并提示文案)。
        """

        src = str(entry.get("src", "")).strip()
        entry["src"] = src

        if not src:
            # 空 src 等价于删除该条目。
            if 0 <= self.current_index < len(self.entries):
                del self.entries[self.current_index]
            self.current_index = -1
            return False, ""

        duplicate_index = -1
        for i, existing in enumerate(self.entries):
            if i == self.current_index:
                continue
            if str(existing.get("src", "")).strip() == src:
                duplicate_index = i
                break

        if duplicate_index < 0:
            self.entries[self.current_index] = dict(entry)
            return False, ""

        keep_index = min(self.current_index, duplicate_index)
        drop_index = max(self.current_index, duplicate_index)
        self.entries[keep_index] = dict(entry)
        del self.entries[drop_index]
        self.current_index = keep_index
        return True, Localizer.get().quality_merge_duplication

    def cleanup_empty_entries(self) -> None:
        self.entries = [
            v
            for v in self.entries
            if isinstance(v, dict) and str(v.get("src", "")).strip() != ""
        ]

    # ==================== 搜索栏 ====================

    def show_search_bar(self) -> None:
        self.search_card.setVisible(True)
        self.command_bar_card.setVisible(False)
        self.search_card.get_line_edit().setFocus()

    def on_search_back_clicked(self) -> None:
        def action() -> None:
            self.search_card.reset_state()
            self.search_card.setVisible(False)
            self.command_bar_card.setVisible(True)

        self.run_with_unsaved_guard(action)

    def on_search_prev_clicked(self) -> None:
        self.run_with_unsaved_guard(lambda: self.search_card.run_table_search(True))

    def on_search_next_clicked(self) -> None:
        self.run_with_unsaved_guard(lambda: self.search_card.run_table_search(False))

    def on_search_triggered(self) -> None:
        self.run_with_unsaved_guard(lambda: self.search_card.run_table_search(False))

    def on_search_mode_changed(self) -> None:
        self.run_with_unsaved_guard(lambda: self.search_card.apply_table_search())

    # ==================== 命令栏 ====================

    def import_rules_from_path(self, path: str) -> None:
        current_src = ""
        if 0 <= self.current_index < len(self.entries):
            current_src = str(self.entries[self.current_index].get("src", "")).strip()

        incoming = QualityRuleIO.load_rules_from_file(path)
        merged, report = QualityRuleMerge.merge_overwrite(self.entries, incoming)
        self.entries = merged
        self.cleanup_empty_entries()
        self.save_entries(self.entries)
        self.ignore_next_quality_rule_update = True
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

    def add_command_bar_action_import(self, window: FluentWindow) -> CommandButton:
        del window

        def triggered() -> None:
            path, _ = QFileDialog.getOpenFileName(
                None,
                Localizer.get().select_file,
                "",
                Localizer.get().quality_select_file_type,
            )
            if not isinstance(path, str) or not path:
                return
            self.import_rules_from_path(path)

        return self.command_bar_card.add_action(
            Action(
                FluentIcon.DOWNLOAD,
                Localizer.get().quality_import,
                triggered=lambda: self.run_with_unsaved_guard(triggered),
            )
        )

    def add_command_bar_action_export(self, window: FluentWindow) -> CommandButton:
        def triggered() -> None:
            path, _ = QFileDialog.getSaveFileName(
                window,
                Localizer.get().select_file,
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

        return self.command_bar_card.add_action(
            Action(
                FluentIcon.SHARE,
                Localizer.get().quality_export,
                triggered=lambda: self.run_with_unsaved_guard(triggered),
            )
        )

    def add_command_bar_action_search(self) -> CommandButton:
        return self.command_bar_card.add_action(
            Action(
                FluentIcon.SEARCH,
                Localizer.get().search,
                triggered=self.show_search_bar,
            )
        )

    def add_command_bar_action_preset(
        self, config: Config, window: FluentWindow
    ) -> CommandButton:
        self.preset_manager = QualityRulePresetManager(
            preset_dir_name=self.PRESET_DIR_NAME,
            default_preset_config_key=self.DEFAULT_PRESET_CONFIG_KEY,
            config=config,
            page=self,
            window=window,
        )

        def triggered() -> None:
            if self.preset_manager is None:
                return
            menu = self.preset_manager.build_preset_menu(widget)
            global_pos = widget.mapToGlobal(QPoint(0, 0))
            menu.exec(global_pos, ani=True, aniType=MenuAnimationType.PULL_UP)

        widget = self.command_bar_card.add_action(
            Action(
                FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                Localizer.get().quality_preset,
                triggered=triggered,
            )
        )
        return widget

    def add_command_bar_action_wiki(self) -> None:
        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki"))

        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(connect)
        self.command_bar_card.add_widget(push_button)
