from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import PushButton
from qfluentwidgets import RoundMenu
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
    retranslate_clicked = pyqtSignal(object)    # (item) 重新翻译
    copy_src_clicked = pyqtSignal(object)       # (item) 复制原文到译文
    copy_dst_clicked = pyqtSignal(object)       # (item) 复制译文到剪贴板

    # 列索引常量
    COL_SRC = 0
    COL_DST = 1
    COL_STATUS = 2
    COL_ACTION = 3

    # Item 数据存储的角色
    ITEM_ROLE = Qt.UserRole + 1

    # 翻译状态图标（未翻译不显示）
    STATUS_ICONS = {
        # Base.ProjectStatus.NONE: 不显示
        Base.ProjectStatus.PROCESSING: FluentIcon.SYNC,
        Base.ProjectStatus.PROCESSED: FluentIcon.ACCEPT,
        Base.ProjectStatus.PROCESSED_IN_PAST: FluentIcon.HISTORY,
        Base.ProjectStatus.EXCLUDED: FluentIcon.REMOVE,
        Base.ProjectStatus.DUPLICATED: FluentIcon.COPY,
    }

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
        self.setBorderVisible(False)

        # 多行文本支持
        self.setWordWrap(True)
        self.verticalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)

        # 设置列宽
        header = self.horizontalHeader()
        header.setSectionResizeMode(self.COL_SRC, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_DST, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_STATUS, QHeaderView.Fixed)
        header.setSectionResizeMode(self.COL_ACTION, QHeaderView.Fixed)
        self.setColumnWidth(self.COL_STATUS, 60)
        self.setColumnWidth(self.COL_ACTION, 80)

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
        """填充表格数据"""
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
        # 原文列
        src_item = QTableWidgetItem(item.get_src())
        src_item.setFlags(src_item.flags() & ~Qt.ItemIsEditable)
        src_item.setData(self.ITEM_ROLE, item)
        src_item.setTextAlignment(Qt.AlignTop | Qt.AlignLeft)
        self.setItem(row, self.COL_SRC, src_item)

        # 译文列
        dst_item = QTableWidgetItem(item.get_dst())
        dst_item.setTextAlignment(Qt.AlignTop | Qt.AlignLeft)
        if self._readonly:
            dst_item.setFlags(dst_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, self.COL_DST, dst_item)

        # 状态列
        self._create_status_widget(row, item, errors)

        # 操作列
        self._create_action_widget(row, item)

    def _create_status_widget(self, row: int, item: Item, errors: list[ErrorType]) -> None:
        """创建状态显示组件"""
        widget = QWidget()
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)
        layout.setAlignment(Qt.AlignCenter)

        status = item.get_status()

        # 翻译状态图标（未翻译不显示）
        if status in self.STATUS_ICONS:
            status_icon = IconWidget(self.STATUS_ICONS[status])
            status_icon.setFixedSize(16, 16)
            status_icon.installEventFilter(ToolTipFilter(status_icon, 300, ToolTipPosition.TOP))
            status_icon.setToolTip(self._get_status_text(status))
            layout.addWidget(status_icon)

        # 错误图标（有错误才显示，统一使用警告图标）
        if errors:
            error_icon = IconWidget(FluentIcon.INFO)  # 使用 INFO 图标表示有问题需要关注
            error_icon.setFixedSize(16, 16)
            error_texts = [self._get_error_text(e) for e in errors]
            error_icon.installEventFilter(ToolTipFilter(error_icon, 300, ToolTipPosition.TOP))
            error_icon.setToolTip("\n".join(error_texts))
            layout.addWidget(error_icon)

        self.setCellWidget(row, self.COL_STATUS, widget)

    def _get_status_text(self, status: Base.ProjectStatus) -> str:
        """获取翻译状态的本地化文本"""
        status_texts = {
            Base.ProjectStatus.NONE: Localizer.get().proofreading_page_status_none,
            Base.ProjectStatus.PROCESSING: Localizer.get().proofreading_page_status_processing,
            Base.ProjectStatus.PROCESSED: Localizer.get().proofreading_page_status_processed,
            Base.ProjectStatus.PROCESSED_IN_PAST: Localizer.get().proofreading_page_status_processed_in_past,
            Base.ProjectStatus.EXCLUDED: Localizer.get().proofreading_page_status_excluded,
            Base.ProjectStatus.DUPLICATED: Localizer.get().proofreading_page_status_duplicated,
        }
        return status_texts.get(status, str(status))

    def _get_error_text(self, error: ErrorType) -> str:
        """获取错误类型的本地化文本"""
        error_texts = {
            ErrorType.KANA: Localizer.get().proofreading_page_error_kana,
            ErrorType.HANGEUL: Localizer.get().proofreading_page_error_hangeul,
            ErrorType.TEXT_PRESERVE: Localizer.get().proofreading_page_error_text_preserve,
            ErrorType.SIMILARITY: Localizer.get().proofreading_page_error_similarity,
            ErrorType.GLOSSARY: Localizer.get().proofreading_page_error_glossary,
            ErrorType.RETRY_THRESHOLD: Localizer.get().proofreading_page_error_retry,
        }
        return error_texts.get(error, str(error))

    def _create_action_widget(self, row: int, item: Item) -> None:
        """创建操作按钮"""
        widget = QWidget()
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(0)

        btn_action = PushButton(Localizer.get().proofreading_page_col_action)
        btn_action.setFixedHeight(28)
        btn_action.setEnabled(not self._readonly and row not in self._loading_rows)

        def show_menu() -> None:
            menu = RoundMenu(parent=btn_action)

            # 重新翻译
            menu.addAction(Action(
                FluentIcon.SYNC,
                Localizer.get().proofreading_page_retranslate,
                triggered=lambda checked: self.retranslate_clicked.emit(item)
            ))

            # 复制原文到译文
            menu.addAction(Action(
                FluentIcon.PASTE,
                Localizer.get().proofreading_page_copy_src,
                triggered=lambda checked: self.copy_src_clicked.emit(item)
            ))

            # 复制译文到剪贴板
            menu.addAction(Action(
                FluentIcon.COPY,
                Localizer.get().proofreading_page_copy_dst,
                triggered=lambda checked: self.copy_dst_clicked.emit(item)
            ))

            menu.exec(btn_action.mapToGlobal(btn_action.rect().bottomLeft()))

        btn_action.clicked.connect(show_menu)
        layout.addWidget(btn_action)

        self.setCellWidget(row, self.COL_ACTION, widget)

    def get_item_at_row(self, row: int) -> Item | None:
        """获取指定行绑定的 Item 对象"""
        src_cell = self.item(row, self.COL_SRC)
        if src_cell:
            return src_cell.data(self.ITEM_ROLE)
        return None

    def update_row_status(self, row: int, errors: list[ErrorType]) -> None:
        """更新指定行的状态"""
        item = self.get_item_at_row(row)
        if item:
            self._create_status_widget(row, item, errors)

    def set_row_loading(self, row: int, loading: bool) -> None:
        """设置指定行为加载中状态"""
        if loading:
            self._loading_rows.add(row)
        else:
            self._loading_rows.discard(row)

        widget = self.cellWidget(row, self.COL_ACTION)
        if widget:
            for btn in widget.findChildren(PushButton):
                btn.setEnabled(not loading and not self._readonly)

    def set_readonly(self, readonly: bool) -> None:
        """设置表格只读模式"""
        self._readonly = readonly

        for row in range(self.rowCount()):
            dst_cell = self.item(row, self.COL_DST)
            if dst_cell:
                flags = dst_cell.flags()
                if readonly:
                    flags = flags & ~Qt.ItemIsEditable
                else:
                    flags = flags | Qt.ItemIsEditable
                dst_cell.setFlags(flags)

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
