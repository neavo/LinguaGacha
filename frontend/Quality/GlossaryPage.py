import json
import os
from functools import partial
from pathlib import Path
from typing import Any

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPixmap
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableItemDelegate
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import getFont
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig
from qfluentwidgets import setCustomStyleSheet
from qfluentwidgets import themeColor

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


class GlossaryTableItemDelegate(TableItemDelegate):
    """在保持 QFluentWidgets 表格悬浮/选中效果的前提下，单独绘制规则列图标。"""

    def __init__(self, parent, case_column_index: int, icon_size: int) -> None:
        super().__init__(parent)
        self.case_column_index = case_column_index
        self.icon_size = icon_size

    def paint(self, painter, option, index) -> None:
        if index.column() != self.case_column_index:
            super().paint(painter, option, index)
            return

        # 复制 TableItemDelegate.paint 的背景逻辑，避免覆盖 QFluentWidgets 的一体悬浮/选中效果。
        painter.save()
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        painter.setClipping(True)
        painter.setClipRect(option.rect)

        option.rect.adjust(0, self.margin, 0, -self.margin)

        is_hover = self.hoverRow == index.row()
        is_pressed = self.pressedRow == index.row()
        table = self.parent()
        alternating_fn = getattr(table, "alternatingRowColors", None)
        alternating = bool(alternating_fn()) if callable(alternating_fn) else False
        is_alternate = index.row() % 2 == 0 and alternating
        is_dark = isDarkTheme()

        c = 255 if is_dark else 0
        alpha = 0

        if index.row() not in self.selectedRows:
            if is_pressed:
                alpha = 9 if is_dark else 6
            elif is_hover:
                alpha = 12
            elif is_alternate:
                alpha = 5
        else:
            if is_pressed:
                alpha = 15 if is_dark else 9
            elif is_hover:
                alpha = 25
            else:
                alpha = 17

        if index.data(Qt.ItemDataRole.BackgroundRole):
            painter.setBrush(index.data(Qt.ItemDataRole.BackgroundRole))
        else:
            painter.setBrush(QColor(c, c, c, alpha))

        self._drawBackground(painter, option, index)
        painter.restore()

        decoration = index.data(Qt.ItemDataRole.DecorationRole)
        if not isinstance(decoration, QPixmap):
            return

        rect = option.rect
        x = rect.x() + (rect.width() - self.icon_size) // 2
        y = rect.y() + (rect.height() - self.icon_size) // 2
        painter.drawPixmap(x, y, decoration)


class GlossaryPage(QualityRuleSplitPageBase):
    BASE: str = "glossary"

    CASE_COLUMN_INDEX: int = 3
    CASE_COLUMN_WIDTH: int = 80
    CASE_ICON_SIZE: int = 24
    CASE_ICON_INNER_SIZE: int = 12
    CASE_ICON_BORDER_WIDTH: int = 1
    CASE_ICON_LUMA_THRESHOLD: float = 0.75

    QUALITY_RULE_TYPES: set[str] = {DataManager.RuleType.GLOSSARY.value}
    QUALITY_META_KEYS: set[str] = {"glossary_enable"}

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(text, window)

        # Glossary 表格在大数据量下全量 refresh 开销很高。
        # 保存/切换大小写时跳过一次由自身触发的 QUALITY_RULE_UPDATE，避免重复 reload+refresh。
        self.ignore_next_quality_rule_update: bool = False

        # 缓存主题下的图标 pixmap，避免频繁重绘拖慢刷新。
        self.case_pixmap_cache: dict[tuple[bool, bool, int], QPixmap] = {}

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
        # 高级规则列使用图标展示，不需要文本
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

        if self.ignore_next_quality_rule_update:
            self.ignore_next_quality_rule_update = False
            return
        self.request_reload()

    def refresh_table_row(self, row: int) -> None:
        """仅刷新单行，避免保存时全量刷新。"""

        if row < 0 or row >= self.table.rowCount():
            return

        col_count = self.table.columnCount()
        values = ("",) * col_count
        editable = False
        case_sensitive = False

        if row < len(self.entries):
            values = self.get_row_values(self.entries[row])
            editable = True
            case_sensitive = bool(self.entries[row].get("case_sensitive", False))

        for col in range(col_count):
            if col == self.CASE_COLUMN_INDEX:
                self.update_case_cell_item(row, case_sensitive, editable)
                continue

            item = self.table.item(row, col)
            if item is None:
                item = QTableWidgetItem()
                self.table.setItem(row, col, item)

            item.setText(values[col] if col < len(values) else "")
            item.setFont(self.ui_font)
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            if editable:
                flags: Qt.ItemFlags = Qt.ItemFlags(Qt.ItemFlag.NoItemFlags)
                flags |= Qt.ItemFlag.ItemIsEnabled
                flags |= Qt.ItemFlag.ItemIsSelectable
                item.setFlags(flags)
            else:
                flags: Qt.ItemFlags = Qt.ItemFlags(Qt.ItemFlag.NoItemFlags)
                flags |= Qt.ItemFlag.ItemIsEnabled
                item.setFlags(flags)

    def save_current_entry(self) -> None:
        """重写保存逻辑：大数据量下仅更新单行，避免明显卡顿。"""

        if self.current_index < 0 or self.current_index >= len(self.entries):
            return

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
            # 由 DataManager 写入触发的事件会在下一轮事件循环处理；这里标记跳过一次。
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
            # 常见路径：只更新当前行内容与开关状态。
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

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_save_toast,
            },
        )

        action = self.pending_action
        self.pending_action = None
        self.pending_revert = None
        if callable(action):
            action()

        if self.reload_pending:
            self.reload_entries()

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

        self.table.setIconSize(QSize(self.CASE_ICON_SIZE, self.CASE_ICON_SIZE))
        self.table.setItemDelegate(
            GlossaryTableItemDelegate(
                self.table,
                case_column_index=self.CASE_COLUMN_INDEX,
                icon_size=self.CASE_ICON_SIZE,
            )
        )

        # 列宽：原文/译文拉伸，描述拉伸，高级规则列固定窄宽
        header = self.table.horizontalHeader()
        if header is not None:
            header.setStretchLastSection(False)
            # 原文、译文、描述均拉伸
            header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
            header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
            # 高级规则列固定宽度
            header.setSectionResizeMode(
                self.CASE_COLUMN_INDEX, QHeaderView.ResizeMode.Fixed
            )
            self.table.setColumnWidth(self.CASE_COLUMN_INDEX, self.CASE_COLUMN_WIDTH)

    def disconnect_theme_signals(self) -> None:
        try:
            qconfig.themeChanged.disconnect(self.on_theme_changed)
        except (TypeError, RuntimeError):
            pass

    def on_theme_changed(self) -> None:
        self.case_pixmap_cache.clear()
        self.refresh_table()

    def get_case_tooltip(self, case_sensitive: bool) -> str:
        return (
            f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_on}"
            if case_sensitive
            else f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_off}"
        )

    def get_case_pixmap(self, case_sensitive: bool) -> QPixmap:
        is_dark = isDarkTheme()
        try:
            dpr = float(self.table.devicePixelRatioF())
        except Exception:
            dpr = 1.0

        cache_key = (is_dark, case_sensitive, int(round(dpr * 100)))
        cached = self.case_pixmap_cache.get(cache_key)
        if cached is not None:
            return cached

        pixmap = self.build_case_icon_pixmap(case_sensitive, is_dark, dpr)
        self.case_pixmap_cache[cache_key] = pixmap
        return pixmap

    def build_case_icon_pixmap(
        self, case_sensitive: bool, is_dark: bool, dpr: float
    ) -> QPixmap:
        size = self.CASE_ICON_SIZE
        size_px = max(1, int(round(size * dpr)))

        # 先用物理像素绘制，最后再设置 DPR，避免坐标系混乱导致缩放/裁切。
        pixmap = QPixmap(size_px, size_px)
        pixmap.fill(Qt.GlobalColor.transparent)

        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        border_px = max(1, int(round(self.CASE_ICON_BORDER_WIDTH * dpr)))

        if case_sensitive:
            rect = pixmap.rect()
            border_color = Qt.GlobalColor.transparent
            bg_color = QColor(themeColor())
            bg_color.setAlpha(255)
            icon_color = self.pick_contrast_color(bg_color)
        else:
            # 对齐 PillToolButton 默认未选中样式（非可交互，只绘制静态态）。
            rect = pixmap.rect().adjusted(border_px, border_px, -border_px, -border_px)
            border_color = QColor(255, 255, 255, 18) if is_dark else QColor(0, 0, 0, 15)
            bg_color = (
                QColor(255, 255, 255, 15) if is_dark else QColor(243, 243, 243, 194)
            )
            icon_color = QColor(255, 255, 255, 170) if is_dark else QColor(0, 0, 0, 140)

        painter.setPen(border_color)
        painter.setBrush(bg_color)
        radius = rect.height() / 2
        painter.drawRoundedRect(rect, radius, radius)

        inner_px = max(1, int(round(self.CASE_ICON_INNER_SIZE * dpr)))
        icon_pixmap = FluentIcon.FONT.icon().pixmap(inner_px, inner_px)
        icon_pixmap = self.tint_pixmap(icon_pixmap, icon_color)
        offset_px = (size_px - inner_px) // 2
        painter.drawPixmap(offset_px, offset_px, icon_pixmap)
        painter.end()

        try:
            pixmap.setDevicePixelRatio(dpr)
        except Exception:
            pass
        return pixmap

    def tint_pixmap(self, base: QPixmap, color: QColor) -> QPixmap:
        tinted = QPixmap(base.size())
        tinted.fill(Qt.GlobalColor.transparent)

        painter = QPainter(tinted)
        painter.setCompositionMode(QPainter.CompositionMode_Source)
        painter.drawPixmap(0, 0, base)
        painter.setCompositionMode(QPainter.CompositionMode_SourceIn)
        painter.fillRect(tinted.rect(), color)
        painter.end()
        return tinted

    def pick_contrast_color(self, color: QColor) -> QColor:
        luma = 0.2126 * color.redF() + 0.7152 * color.greenF() + 0.0722 * color.blueF()
        if luma > self.CASE_ICON_LUMA_THRESHOLD:
            return QColor(0, 0, 0)
        return QColor(255, 255, 255)

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
                self.get_case_pixmap(case_sensitive),
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

    def refresh_table(self) -> None:
        """重写刷新表格方法，为每个单元格设置字体"""
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
            case_sensitive = False

            if row < len(self.entries):
                values = self.get_row_values(self.entries[row])
                editable = True
                case_sensitive = bool(self.entries[row].get("case_sensitive", False))

            for col in range(col_count):
                if col == self.CASE_COLUMN_INDEX:
                    self.update_case_cell_item(row, case_sensitive, editable)
                    continue

                item = self.table.item(row, col)
                if item is None:
                    item = QTableWidgetItem()
                    self.table.setItem(row, col, item)

                item.setText(values[col] if col < len(values) else "")
                item.setFont(self.ui_font)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                if editable:
                    flags: Qt.ItemFlags = Qt.ItemFlags(Qt.ItemFlag.NoItemFlags)
                    flags |= Qt.ItemFlag.ItemIsEnabled
                    flags |= Qt.ItemFlag.ItemIsSelectable
                    item.setFlags(flags)
                else:
                    flags: Qt.ItemFlags = Qt.ItemFlags(Qt.ItemFlag.NoItemFlags)
                    flags |= Qt.ItemFlag.ItemIsEnabled
                    item.setFlags(flags)

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
