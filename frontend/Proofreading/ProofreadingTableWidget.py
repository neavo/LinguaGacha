from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QContextMenuEvent
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QFontMetrics
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType


class ProofreadingTableWidget(TableWidget):
    """校对任务专用表格组件"""

    # 信号定义
    retranslate_clicked = pyqtSignal(object)  # (item) 重新翻译
    batch_retranslate_clicked = pyqtSignal(list)  # (items) 批量重新翻译
    reset_translation_clicked = pyqtSignal(object)  # (item) 重置翻译
    batch_reset_translation_clicked = pyqtSignal(list)  # (items) 批量重置翻译
    copy_src_clicked = pyqtSignal(object)  # (item) 复制原文到剪贴板
    copy_dst_clicked = pyqtSignal(object)  # (item) 复制译文到剪贴板

    # 列索引常量
    COL_SRC = 0
    COL_DST = 1
    COL_STATUS = 2

    # 布局常量
    COL_WIDTH_STATUS = 60
    ROW_NUMBER_MIN_WIDTH = 40

    UI_FONT_PX = 12

    # Item 数据存储的角色
    ITEM_ROLE = Qt.UserRole + 1

    # 翻译状态图标（未翻译不显示）
    STATUS_ICONS = {
        Base.ProjectStatus.PROCESSED: FluentIcon.COMPLETED,
        Base.ProjectStatus.PROCESSED_IN_PAST: FluentIcon.HISTORY,
        Base.ProjectStatus.ERROR: FluentIcon.INFO,
        Base.ProjectStatus.LANGUAGE_SKIPPED: FluentIcon.REMOVE_FROM,
    }

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        self.ui_font = QFont(self.font())
        self.ui_font.setPixelSize(self.UI_FONT_PX)
        self.setFont(self.ui_font)

        # 设置列头
        self.setColumnCount(3)
        self.setHorizontalHeaderLabels(
            [
                Localizer.get().proofreading_page_col_src,
                Localizer.get().proofreading_page_col_dst,
                Localizer.get().proofreading_page_col_status,
            ]
        )

        # WHY: QFluentWidgets 的样式可能覆盖控件 font；通过 header item 的 FontRole 强制生效。
        for col in range(self.columnCount()):
            header_item = self.horizontalHeaderItem(col)
            if header_item is not None:
                header_item.setFont(self.ui_font)

        # 设置表格属性
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        # 支持 Ctrl/Shift 多选和拖拽选择
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)

        # WHY: 校对列表允许滚轮滚动，但不显示右侧滚动条，避免视觉干扰。
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        # 禁用默认的双击编辑，改为双击弹出对话框
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.verticalHeader().setDefaultAlignment(Qt.AlignCenter)
        self.verticalHeader().setFixedWidth(self.ROW_NUMBER_MIN_WIDTH)
        self.setBorderVisible(False)

        # 文本拼接为单行显示
        self.setWordWrap(False)
        self.setTextElideMode(Qt.ElideRight)
        self.verticalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.verticalHeader().setMinimumSectionSize(40)

        # 设置列宽
        header = self.horizontalHeader()
        header.setFont(self.ui_font)
        header.setSectionResizeMode(self.COL_SRC, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_DST, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_STATUS, QHeaderView.Fixed)
        self.setColumnWidth(self.COL_STATUS, self.COL_WIDTH_STATUS)
        header.setDefaultAlignment(Qt.AlignCenter)

        self.verticalHeader().setFont(self.ui_font)

        # 只读模式标志
        self.readonly = False

        self.setAlternatingRowColors(True)

    def set_items(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        start_index: int = 0,
    ) -> None:
        """填充表格数据"""
        self.blockSignals(True)
        self.setUpdatesEnabled(False)

        # 先移除所有 cell widgets，避免 qfluentwidgets styleSheetManager 迭代问题
        self.clear_cell_widgets()

        self.clearContents()
        if not items:
            # 显示 30 行空行占位，保持表格样式铺满
            self.setRowCount(30)
            for row in range(30):
                for col in range(self.columnCount()):
                    item = QTableWidgetItem("")
                    item.setFont(self.ui_font)
                    # 设置为只读且不可选中，但保持启用状态以维持样式
                    item.setFlags(Qt.ItemIsEnabled)
                    self.setItem(row, col, item)
            self.set_vertical_header_labels([])
            self.update_row_number_width(0)
        else:
            self.setRowCount(len(items))
            for row, item in enumerate(items):
                self.set_row_data(row, item, warning_map.get(id(item), []))

            self.set_vertical_header_labels(
                [str(start_index + i + 1) for i in range(len(items))]
            )
            self.update_row_number_width(start_index + len(items))

        self.resizeRowsToContents()
        self.setUpdatesEnabled(True)
        self.blockSignals(False)

    def set_vertical_header_labels(self, labels: list[str]) -> None:
        if not labels:
            labels = ["" for _ in range(self.rowCount())]
        if len(labels) < self.rowCount():
            labels += ["" for _ in range(self.rowCount() - len(labels))]

        for row in range(self.rowCount()):
            item = self.verticalHeaderItem(row)
            label = labels[row]
            if item is None:
                item = QTableWidgetItem(label)
                self.setVerticalHeaderItem(row, item)
            else:
                item.setText(label)
            item.setFont(self.ui_font)
            item.setTextAlignment(Qt.AlignCenter)

    def update_row_number_width(self, max_label_value: int) -> None:
        digits = len(str(max(1, max_label_value)))
        metrics = QFontMetrics(self.ui_font)
        text_width = metrics.horizontalAdvance("9" * digits)
        self.verticalHeader().setFixedWidth(
            max(self.ROW_NUMBER_MIN_WIDTH, text_width + 16)
        )

    def clear_cell_widgets(self) -> None:
        """移除所有 cell widgets"""
        for row in range(self.rowCount()):
            widget = self.cellWidget(row, self.COL_STATUS)
            if widget:
                self.removeCellWidget(row, self.COL_STATUS)
                widget.deleteLater()

    def set_row_data(self, row: int, item: Item, warnings: list[WarningType]) -> None:
        """设置单行数据"""
        src_text = self.compact_multiline_text(item.get_src())
        dst_text = self.compact_multiline_text(item.get_dst())

        # 原文列：拼接多行文本后单行显示
        src_item = QTableWidgetItem(src_text)
        src_item.setFont(self.ui_font)
        src_item.setFlags(src_item.flags() & ~Qt.ItemIsEditable)
        src_item.setData(self.ITEM_ROLE, item)
        src_item.setTextAlignment(Qt.AlignVCenter | Qt.AlignLeft)
        self.setItem(row, self.COL_SRC, src_item)

        # 译文列：拼接多行文本后单行显示
        dst_item = QTableWidgetItem(dst_text)
        dst_item.setFont(self.ui_font)
        dst_item.setTextAlignment(Qt.AlignVCenter | Qt.AlignLeft)
        if self.readonly:
            dst_item.setFlags(dst_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, self.COL_DST, dst_item)

        # 状态列
        self.create_status_widget(row, item, warnings)

    def create_status_widget(
        self,
        row: int,
        item: Item,
        warnings: list[WarningType],
    ) -> None:
        """创建翻译状态与结果检查显示组件"""
        widget = QWidget()
        # 固定高度与行高一致，确保 layout 能正确计算居中位置
        widget.setFixedHeight(40)
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)
        # 使用 AlignCenter 统一控制水平和垂直居中
        layout.setAlignment(Qt.AlignCenter)

        status = item.get_status()

        # 翻译状态图标（未翻译不显示）
        if status in self.STATUS_ICONS:
            status_icon = IconWidget(self.STATUS_ICONS[status])
            status_icon.setFixedSize(16, 16)
            status_icon.installEventFilter(
                ToolTipFilter(status_icon, 300, ToolTipPosition.TOP)
            )
            status_tooltip = (
                f"{Localizer.get().proofreading_page_filter_status}\n"
                f"{Localizer.get().current_status}{self.get_status_text(status)}"
            )
            status_icon.setToolTip(status_tooltip)
            layout.addWidget(status_icon)

        if warnings:
            warning_icon = IconWidget(FluentIcon.VPN)
            warning_icon.setFixedSize(16, 16)
            warning_texts = [self.get_warning_text(e) for e in warnings]
            warning_icon.installEventFilter(
                ToolTipFilter(warning_icon, 300, ToolTipPosition.TOP)
            )
            warning_tooltip = (
                f"{Localizer.get().proofreading_page_warning_tooltip_title}\n"
                f"{Localizer.get().current_status}{' | '.join(warning_texts)}"
            )
            warning_icon.setToolTip(warning_tooltip)
            layout.addWidget(warning_icon)

        self.setCellWidget(row, self.COL_STATUS, widget)

    def get_status_text(self, status: Base.ProjectStatus) -> str:
        """获取翻译状态的本地化文本"""
        status_texts = {
            Base.ProjectStatus.NONE: Localizer.get().proofreading_page_status_none,
            Base.ProjectStatus.PROCESSED: Localizer.get().proofreading_page_status_processed,
            Base.ProjectStatus.PROCESSED_IN_PAST: Localizer.get().proofreading_page_status_processed_in_past,
            Base.ProjectStatus.ERROR: Localizer.get().proofreading_page_status_error,
            Base.ProjectStatus.LANGUAGE_SKIPPED: Localizer.get().proofreading_page_status_non_target_source_language,
        }
        return status_texts.get(status, str(status))

    def get_warning_text(self, warning: WarningType) -> str:
        """获取警告类型的本地化文本"""
        warning_texts = {
            WarningType.KANA: Localizer.get().proofreading_page_warning_kana,
            WarningType.HANGEUL: Localizer.get().proofreading_page_warning_hangeul,
            WarningType.TEXT_PRESERVE: Localizer.get().proofreading_page_warning_text_preserve,
            WarningType.SIMILARITY: Localizer.get().proofreading_page_warning_similarity,
            WarningType.GLOSSARY: Localizer.get().proofreading_page_warning_glossary,
            WarningType.RETRY_THRESHOLD: Localizer.get().proofreading_page_warning_retry,
        }
        return warning_texts.get(warning, str(warning))

    def get_item_at_row(self, row: int) -> Item | None:
        """获取指定行绑定的 Item 对象"""
        src_cell = self.item(row, self.COL_SRC)
        if src_cell:
            return src_cell.data(self.ITEM_ROLE)
        return None

    def update_row_status(self, row: int, warnings: list[WarningType]) -> None:
        """更新指定行的状态"""
        item = self.get_item_at_row(row)
        if item:
            self.create_status_widget(row, item, warnings)

    def set_readonly(self, readonly: bool) -> None:
        """设置表格只读模式"""
        self.readonly = readonly

        for row in range(self.rowCount()):
            dst_cell = self.item(row, self.COL_DST)
            if dst_cell:
                flags = dst_cell.flags()
                if readonly:
                    flags = flags & ~Qt.ItemIsEditable
                else:
                    flags = flags | Qt.ItemIsEditable
                dst_cell.setFlags(flags)

    def find_row_by_item(self, item: Item) -> int:
        """根据 Item 对象查找行索引"""
        for row in range(self.rowCount()):
            if self.get_item_at_row(row) is item:
                return row
        return -1

    def compact_multiline_text(self, text: str) -> str:
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        parts = [part.strip() for part in normalized.split("\n") if part.strip()]
        return " ↲ ".join(parts)

    def update_row_dst(self, row: int, new_dst: str) -> None:
        """更新指定行的译文"""
        self.blockSignals(True)
        dst_cell = self.item(row, self.COL_DST)
        if dst_cell:
            dst_cell.setText(self.compact_multiline_text(new_dst))

        self.blockSignals(False)
        self.resizeRowToContents(row)

    def select_row(self, row: int) -> None:
        """选中指定行并滚动到可见区域"""
        if row < 0 or row >= self.rowCount():
            return
        self.selectRow(row)
        # 延迟滚动，确保 cell widget 布局先完成更新
        QTimer.singleShot(
            0,
            lambda: self.scrollToItem(
                self.item(row, self.COL_SRC), QAbstractItemView.PositionAtCenter
            ),
        )

    def get_selected_items(self) -> list[Item]:
        """获取所有选中行对应的 Item 对象"""
        items = []
        for row in sorted(set(index.row() for index in self.selectedIndexes())):
            item = self.get_item_at_row(row)
            if item:
                items.append(item)
        return items

    def get_selected_row(self) -> int:
        """获取当前选中的首行索引"""
        rows = sorted(set(index.row() for index in self.selectedIndexes()))
        return rows[0] if rows else -1

    def contextMenuEvent(self, event: QContextMenuEvent) -> None:
        """右键菜单事件"""
        if self.readonly:
            return

        # 获取点击位置的 item
        item = self.itemAt(event.pos())
        if item:
            row = item.row()
            # 如果点击的行不在选中范围内，则选中该行
            # 这样可以在保留多选的情况下，修正右键点击未选中行时的行为
            selected_rows = {index.row() for index in self.selectedIndexes()}
            if row not in selected_rows:
                self.selectRow(row)

        selected_items = self.get_selected_items()
        if not selected_items:
            return

        menu = RoundMenu(parent=self)

        # 统一使用批量重翻逻辑，无论单选还是多选
        menu.addAction(
            Action(
                FluentIcon.SYNC,
                Localizer.get().proofreading_page_batch_retranslate,
                triggered=lambda checked: self.batch_retranslate_clicked.emit(
                    selected_items
                ),
            )
        )

        # 批量重置
        menu.addAction(
            Action(
                FluentIcon.DELETE,
                Localizer.get().proofreading_page_batch_reset_translation,
                triggered=lambda checked: self.batch_reset_translation_clicked.emit(
                    selected_items
                ),
            )
        )

        menu.exec(event.globalPos())
