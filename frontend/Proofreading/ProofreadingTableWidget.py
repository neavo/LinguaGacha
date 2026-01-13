from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import PushButton
from qfluentwidgets import TableWidget
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ErrorType

class ProofreadingTableWidget(TableWidget):
    """校对任务专用表格组件"""

    # 信号定义
    cell_edited = pyqtSignal(object, str)       # (item, new_dst) 单元格编辑完成
    retranslate_clicked = pyqtSignal(object)    # (item) 重新翻译按钮点击
    recheck_clicked = pyqtSignal(object)        # (item) 重新检查按钮点击

    # 列索引常量
    COL_SRC = 0
    COL_DST = 1
    COL_STATUS = 2
    COL_ACTION = 3

    # Item 数据存储的角色
    ITEM_ROLE = Qt.UserRole + 1
    ROW_INDEX_ROLE = Qt.UserRole + 2

    def __init__(self, parent: QWidget = None) -> None:
        super().__init__(parent)

        # 设置列头
        self.setColumnCount(4)
        self.setHorizontalHeaderLabels([
            Localizer.get().proofreading_page_col_src,
            Localizer.get().proofreading_page_col_dst,
            Localizer.get().proofreading_page_col_status,
            Localizer.get().proofreading_page_col_action,
        ])

        # 设置表格属性
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.SingleSelection)
        self.setEditTriggers(QAbstractItemView.DoubleClicked)
        self.verticalHeader().setVisible(False)
        self.setWordWrap(True)

        # 设置列宽
        header = self.horizontalHeader()
        header.setSectionResizeMode(self.COL_SRC, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_DST, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_STATUS, QHeaderView.Fixed)
        header.setSectionResizeMode(self.COL_ACTION, QHeaderView.Fixed)
        self.setColumnWidth(self.COL_STATUS, 80)
        self.setColumnWidth(self.COL_ACTION, 160)

        # 只读模式标志
        self._readonly = False

        # 加载中的行集合
        self._loading_rows: set[int] = set()

        # 连接信号
        self.cellChanged.connect(self._on_cell_changed)

    def set_items(
        self,
        items: list[Item],
        error_map: dict[int, list[ErrorType]]
    ) -> None:
        """填充表格数据，每行持有 Item 强引用"""
        # 阻止信号以提高性能
        self.blockSignals(True)
        self.setUpdatesEnabled(False)

        self.clearContents()
        self.setRowCount(len(items))

        for row, item in enumerate(items):
            self._set_row_data(row, item, error_map.get(id(item), []))

        self.setUpdatesEnabled(True)
        self.blockSignals(False)

    def _set_row_data(
        self,
        row: int,
        item: Item,
        errors: list[ErrorType]
    ) -> None:
        """设置单行数据"""
        # 原文列（只读）
        src_item = QTableWidgetItem(item.get_src())
        src_item.setFlags(src_item.flags() & ~Qt.ItemIsEditable)
        src_item.setData(self.ITEM_ROLE, item)
        src_item.setData(self.ROW_INDEX_ROLE, row)
        self.setItem(row, self.COL_SRC, src_item)

        # 译文列（可编辑）
        dst_item = QTableWidgetItem(item.get_dst())
        if self._readonly:
            dst_item.setFlags(dst_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, self.COL_DST, dst_item)

        # 状态列
        status_item = QTableWidgetItem()
        status_item.setFlags(status_item.flags() & ~Qt.ItemIsEditable)
        self._update_status_cell(status_item, item, errors)
        self.setItem(row, self.COL_STATUS, status_item)

        # 操作列
        self._create_action_widget(row, item)

    def _update_status_cell(
        self,
        cell: QTableWidgetItem,
        item: Item,
        errors: list[ErrorType]
    ) -> None:
        """更新状态单元格"""
        # 构建状态文本和提示
        if item.get_status() == Base.ProjectStatus.PROCESSED:
            if errors:
                # 有错误
                error_texts = [self._get_error_text(e) for e in errors]
                cell.setText("⚠️")
                cell.setToolTip("\n".join(error_texts))
            else:
                # 正常完成
                cell.setText("✓")
                cell.setToolTip(Localizer.get().proofreading_page_status_processed)
        else:
            # 未翻译
            cell.setText("○")
            cell.setToolTip(Localizer.get().proofreading_page_status_none)

        cell.setTextAlignment(Qt.AlignCenter)

    def _get_error_text(self, error: ErrorType) -> str:
        """获取错误类型的本地化文本"""
        error_texts = {
            ErrorType.KANA: Localizer.get().proofreading_page_error_kana,
            ErrorType.HANGEUL: Localizer.get().proofreading_page_error_hangeul,
            ErrorType.TEXT_PRESERVE: Localizer.get().proofreading_page_error_text_preserve,
            ErrorType.SIMILARITY: Localizer.get().proofreading_page_error_similarity,
            ErrorType.GLOSSARY: Localizer.get().proofreading_page_error_glossary,
            ErrorType.UNTRANSLATED: Localizer.get().proofreading_page_error_untranslated,
            ErrorType.RETRY_THRESHOLD: Localizer.get().proofreading_page_error_retry,
        }
        return error_texts.get(error, str(error))

    def _create_action_widget(self, row: int, item: Item) -> None:
        """创建操作按钮区域"""
        widget = QWidget()
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)

        # 重新翻译按钮
        btn_retranslate = PushButton(Localizer.get().proofreading_page_retranslate)
        btn_retranslate.setFixedHeight(28)
        btn_retranslate.setEnabled(not self._readonly and row not in self._loading_rows)
        btn_retranslate.clicked.connect(lambda checked, i=item: self.retranslate_clicked.emit(i))
        layout.addWidget(btn_retranslate)

        self.setCellWidget(row, self.COL_ACTION, widget)

    def get_item_at_row(self, row: int) -> Item | None:
        """获取指定行绑定的 Item 对象"""
        src_cell = self.item(row, self.COL_SRC)
        if src_cell:
            return src_cell.data(self.ITEM_ROLE)
        return None

    def update_row_status(self, row: int, errors: list[ErrorType]) -> None:
        """更新指定行的状态图标和 Tooltip"""
        item = self.get_item_at_row(row)
        if not item:
            return

        status_cell = self.item(row, self.COL_STATUS)
        if status_cell:
            self._update_status_cell(status_cell, item, errors)

    def set_row_loading(self, row: int, loading: bool) -> None:
        """设置指定行为加载中状态"""
        if loading:
            self._loading_rows.add(row)
        else:
            self._loading_rows.discard(row)

        # 更新操作按钮状态
        widget = self.cellWidget(row, self.COL_ACTION)
        if widget:
            for btn in widget.findChildren(PushButton):
                btn.setEnabled(not loading and not self._readonly)

        # 更新状态单元格
        status_cell = self.item(row, self.COL_STATUS)
        if status_cell:
            if loading:
                status_cell.setText("⏳")
                status_cell.setToolTip("翻译中...")
            else:
                # 恢复正常状态
                item = self.get_item_at_row(row)
                if item:
                    self._update_status_cell(status_cell, item, [])

    def set_readonly(self, readonly: bool) -> None:
        """设置表格只读模式"""
        self._readonly = readonly

        # 更新所有行的编辑状态
        for row in range(self.rowCount()):
            dst_cell = self.item(row, self.COL_DST)
            if dst_cell:
                flags = dst_cell.flags()
                if readonly:
                    flags = flags & ~Qt.ItemIsEditable
                else:
                    flags = flags | Qt.ItemIsEditable
                dst_cell.setFlags(flags)

            # 更新操作按钮
            widget = self.cellWidget(row, self.COL_ACTION)
            if widget:
                for btn in widget.findChildren(PushButton):
                    btn.setEnabled(not readonly and row not in self._loading_rows)

    def _on_cell_changed(self, row: int, column: int) -> None:
        """单元格内容变化处理"""
        if column != self.COL_DST:
            return

        item = self.get_item_at_row(row)
        if not item:
            return

        dst_cell = self.item(row, self.COL_DST)
        if dst_cell:
            new_dst = dst_cell.text()
            self.cell_edited.emit(item, new_dst)

    def find_row_by_item(self, item: Item) -> int:
        """根据 Item 对象查找行索引"""
        for row in range(self.rowCount()):
            if self.get_item_at_row(row) is item:
                return row
        return -1

    def update_row_dst(self, row: int, new_dst: str) -> None:
        """更新指定行的译文"""
        self.blockSignals(True)
        dst_cell = self.item(row, self.COL_DST)
        if dst_cell:
            dst_cell.setText(new_dst)
        self.blockSignals(False)
