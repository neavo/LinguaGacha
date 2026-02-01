from typing import Any
from typing import cast

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QContextMenuEvent
from PyQt5.QtGui import QFontMetrics
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import IconWidget
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import getFont
from qfluentwidgets import setCustomStyleSheet

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Proofreading.ProofreadingDomain import ProofreadingDomain
from frontend.Proofreading.ProofreadingLabels import ProofreadingLabels
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType


# ==================== 图标常量 ====================

ICON_STATUS_PROCESSED: BaseIcon = BaseIcon.CIRCLE_CHECK_BIG  # 状态：已处理
ICON_STATUS_PROCESSED_IN_PAST: BaseIcon = BaseIcon.HISTORY  # 状态：过去已处理
ICON_STATUS_ERROR: BaseIcon = BaseIcon.CIRCLE_ALERT  # 状态：错误
ICON_STATUS_LANGUAGE_SKIPPED: BaseIcon = (
    BaseIcon.CIRCLE_MINUS
)  # 状态：跳过（语言不匹配）

ICON_WARNING: BaseIcon = BaseIcon.TRIANGLE_ALERT  # 提示：有告警/需注意
ICON_BATCH_RETRANSLATE: BaseIcon = BaseIcon.REFRESH_CW  # 右键菜单：批量重翻
ICON_BATCH_RESET_TRANSLATION: BaseIcon = BaseIcon.ERASER  # 右键菜单：批量重置译文


class ProofreadingTableWidget(TableWidget):
    """校对任务专用表格组件"""

    # 列索引常量
    COL_SRC = 0
    COL_DST = 1
    COL_STATUS = 2

    # 布局常量
    FONT_SIZE = 12
    ROW_HEIGHT = 40
    COL_STATUS_WIDTH = 60
    ROW_NUMBER_MIN_WIDTH = 40

    # Item 数据存储的角色
    # Qt.UserRole 常量在 stubs 中可能缺失，这里直接使用其数值以保证类型检查通过。
    ITEM_ROLE = 0x0100 + 1

    # 翻译状态图标（未翻译不显示）
    STATUS_ICONS = {
        Base.ProjectStatus.PROCESSED: ICON_STATUS_PROCESSED,
        Base.ProjectStatus.PROCESSED_IN_PAST: ICON_STATUS_PROCESSED_IN_PAST,
        Base.ProjectStatus.ERROR: ICON_STATUS_ERROR,
        Base.ProjectStatus.LANGUAGE_SKIPPED: ICON_STATUS_LANGUAGE_SKIPPED,
    }

    # 信号定义
    retranslate_clicked = pyqtSignal(object)  # (item) 重新翻译
    batch_retranslate_clicked = pyqtSignal(list)  # (items) 批量重新翻译
    reset_translation_clicked = pyqtSignal(object)  # (item) 重置翻译
    batch_reset_translation_clicked = pyqtSignal(list)  # (items) 批量重置翻译
    copy_src_clicked = pyqtSignal(object)  # (item) 复制原文到剪贴板
    copy_dst_clicked = pyqtSignal(object)  # (item) 复制译文到剪贴板

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        # 使用 QFluentWidgets 的字体族生成 QFont，避免 delegate 计算/绘制的 metrics 不一致导致下伸字母被裁剪。
        self.ui_font = getFont(self.FONT_SIZE)
        # 继承应用级 hinting 设置，避免出现狗牙/清晰度差异。
        self.ui_font.setHintingPreference(self.font().hintingPreference())

        # TableWidget 的默认 QSS 会用 `font: 13px --FontFamilies` 覆盖表头/序号字体；这里仅覆盖字号。
        header_qss = (
            "QHeaderView::section {\n"
            f"    font: {self.FONT_SIZE}px --FontFamilies;\n"
            "}\n"
        )
        setCustomStyleSheet(self, header_qss, header_qss)

        # 设置列头
        self.setColumnCount(3)
        self.setHorizontalHeaderLabels(
            [
                Localizer.get().table_col_source,
                Localizer.get().table_col_translation,
                Localizer.get().proofreading_page_col_status,
            ]
        )

        # 设置表格属性
        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        # 支持 Ctrl/Shift 多选和拖拽选择
        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)

        # 校对列表允许滚轮滚动，但不显示右侧滚动条，避免视觉干扰。
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        # 禁用默认的双击编辑，改为双击弹出对话框
        self.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        v_header.setFixedWidth(self.ROW_NUMBER_MIN_WIDTH)
        self.setBorderVisible(False)

        # 文本拼接为单行显示
        self.setWordWrap(False)
        self.setTextElideMode(Qt.TextElideMode.ElideRight)
        # 固定行高避免 ResizeToContents 在翻页时反复测量导致卡顿。
        v_header.setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        v_header.setDefaultSectionSize(self.ROW_HEIGHT)
        v_header.setMinimumSectionSize(self.ROW_HEIGHT)

        # 设置列宽
        header = cast(QHeaderView, self.horizontalHeader())
        header.setSectionResizeMode(self.COL_SRC, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(self.COL_DST, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(self.COL_STATUS, QHeaderView.ResizeMode.Fixed)
        self.setColumnWidth(self.COL_STATUS, self.COL_STATUS_WIDTH)
        header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)

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

        # 空表格只用于占位展示，不接受焦点，避免禁用态点击时出现闪烁的焦点动效。
        if not items:
            self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            self.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        else:
            self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
            self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)

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
                    item.setFlags(Qt.ItemFlag.ItemIsEnabled)
                    self.setItem(row, col, item)
            self.set_vertical_header_labels([])
            self.update_row_number_width(0)
        else:
            self.setRowCount(len(items))
            for row, item in enumerate(items):
                self.set_row_data(
                    row,
                    item,
                    ProofreadingDomain.get_item_warnings(item, warning_map),
                )

            self.set_vertical_header_labels(
                [str(start_index + i + 1) for i in range(len(items))]
            )
            self.update_row_number_width(start_index + len(items))

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
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

    def update_row_number_width(self, max_label_value: int) -> None:
        digits = len(str(max(1, max_label_value)))
        metrics = QFontMetrics(self.ui_font)
        text_width = metrics.horizontalAdvance("9" * digits)
        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setFixedWidth(max(self.ROW_NUMBER_MIN_WIDTH, text_width + 16))

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
        src_item.setFlags(cast(Any, src_item.flags() & ~Qt.ItemFlag.ItemIsEditable))
        src_item.setData(self.ITEM_ROLE, item)
        src_item.setTextAlignment(
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
        )
        self.setItem(row, self.COL_SRC, src_item)

        # 译文列：拼接多行文本后单行显示
        dst_item = QTableWidgetItem(dst_text)
        dst_item.setFont(self.ui_font)
        dst_item.setTextAlignment(
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
        )
        if self.readonly:
            dst_item.setFlags(cast(Any, dst_item.flags() & ~Qt.ItemFlag.ItemIsEditable))
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
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

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
                f"{Localizer.get().status}{ProofreadingLabels.get_status_label(status)}"
            )
            status_icon.setToolTip(status_tooltip)
            layout.addWidget(status_icon)

        if warnings:
            warning_icon = IconWidget(ICON_WARNING)
            warning_icon.setFixedSize(16, 16)
            # Tooltip 文案统一由 Labels 层提供，避免 Table/Dialog/EditPanel 不一致。
            warning_texts = [ProofreadingLabels.get_warning_label(e) for e in warnings]
            warning_icon.installEventFilter(
                ToolTipFilter(warning_icon, 300, ToolTipPosition.TOP)
            )
            warning_tooltip = (
                f"{Localizer.get().proofreading_page_result_check}\n"
                f"{Localizer.get().status}{' | '.join(warning_texts)}"
            )
            warning_icon.setToolTip(warning_tooltip)
            layout.addWidget(warning_icon)

        self.setCellWidget(row, self.COL_STATUS, widget)

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
                    flags = flags & ~Qt.ItemFlag.ItemIsEditable
                else:
                    flags = flags | Qt.ItemFlag.ItemIsEditable
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
        # 行高固定，不需要按内容测量。

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

    def contextMenuEvent(self, a0: QContextMenuEvent | None) -> None:
        """右键菜单事件"""
        if a0 is None:
            return
        if self.readonly:
            return

        # 获取点击位置的 item
        item = self.itemAt(a0.pos())
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
                ICON_BATCH_RETRANSLATE,
                Localizer.get().proofreading_page_batch_retranslate,
                triggered=lambda checked: self.batch_retranslate_clicked.emit(
                    selected_items
                ),
            )
        )

        # 批量重置
        menu.addAction(
            Action(
                ICON_BATCH_RESET_TRANSLATION,
                Localizer.get().proofreading_page_batch_reset_translation,
                triggered=lambda checked: self.batch_reset_translation_clicked.emit(
                    selected_items
                ),
            )
        )

        menu.exec(a0.globalPos())
