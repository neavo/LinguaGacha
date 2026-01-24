from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QContextMenuEvent
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import PillToolButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from frontend.Proofreading.TextEditDialog import TextEditDialog
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType


class ProofreadingTableWidget(TableWidget):
    """校对任务专用表格组件"""

    # 信号定义
    cell_edited = pyqtSignal(object, str)  # (item, new_dst) 单元格编辑完成
    retranslate_clicked = pyqtSignal(object)  # (item) 重新翻译
    batch_retranslate_clicked = pyqtSignal(list)  # (items) 批量重新翻译
    reset_translation_clicked = pyqtSignal(object)  # (item) 重置翻译
    batch_reset_translation_clicked = pyqtSignal(list)  # (items) 批量重置翻译
    copy_src_clicked = pyqtSignal(object)  # (item) 复制原文到译文
    copy_dst_clicked = pyqtSignal(object)  # (item) 复制译文到剪贴板

    # 列索引常量
    COL_SRC = 0
    COL_DST = 1
    COL_STATUS = 2
    COL_ACTION = 3

    # 布局常量
    COL_WIDTH_STATUS = 60
    COL_WIDTH_ACTION = 60
    SYMBOL_NEWLINE = " ↵ "

    # Item 数据存储的角色
    ITEM_ROLE = Qt.UserRole + 1

    # 翻译状态图标（未翻译不显示）
    STATUS_ICONS = {
        Base.ProjectStatus.PROCESSED: FluentIcon.COMPLETED,
        Base.ProjectStatus.PROCESSED_IN_PAST: FluentIcon.HISTORY,
        Base.ProjectStatus.ERROR: FluentIcon.INFO,
    }

    def __init__(self, parent: QWidget = None) -> None:
        super().__init__(parent)

        # 设置列头
        self.setColumnCount(4)
        self.setHorizontalHeaderLabels(
            [
                Localizer.get().proofreading_page_col_src,
                Localizer.get().proofreading_page_col_dst,
                Localizer.get().proofreading_page_col_status,
                "",
            ]
        )

        # 设置表格属性
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        # 支持 Ctrl/Shift 多选和拖拽选择
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        # 禁用默认的双击编辑，改为双击弹出对话框
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.verticalHeader().setDefaultAlignment(Qt.AlignCenter)
        self.setBorderVisible(False)

        # 禁用换行，超宽文本显示省略号
        self.setWordWrap(False)
        self.setTextElideMode(Qt.ElideRight)
        # 设置固定行高
        self.verticalHeader().setSectionResizeMode(QHeaderView.Fixed)
        self.verticalHeader().setDefaultSectionSize(40)

        # 设置列宽
        header = self.horizontalHeader()
        header.setSectionResizeMode(self.COL_SRC, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_DST, QHeaderView.Stretch)
        header.setSectionResizeMode(self.COL_STATUS, QHeaderView.Fixed)
        header.setSectionResizeMode(self.COL_ACTION, QHeaderView.Fixed)
        self.setColumnWidth(self.COL_STATUS, self.COL_WIDTH_STATUS)
        # 操作列变宽
        self.setColumnWidth(self.COL_ACTION, self.COL_WIDTH_ACTION)

        # 只读模式标志
        self._readonly = False

        # 加载中的行集合
        self._loading_rows: set[int] = set()

        # 双击弹出编辑对话框
        self.cellDoubleClicked.connect(self._on_cell_double_clicked)

    def set_items(
        self, items: list[Item], warning_map: dict[int, list[WarningType]]
    ) -> None:
        """填充表格数据"""
        self.blockSignals(True)
        self.setUpdatesEnabled(False)

        # 先移除所有 cell widgets，避免 qfluentwidgets styleSheetManager 迭代问题
        self._clear_cell_widgets()

        self.clearContents()
        if not items:
            # 显示 30 行空行占位，保持表格样式铺满
            self.setRowCount(30)
            for row in range(30):
                for col in range(self.columnCount()):
                    item = QTableWidgetItem("")
                    # 设置为只读且不可选中，但保持启用状态以维持样式
                    item.setFlags(Qt.ItemIsEnabled)
                    self.setItem(row, col, item)
        else:
            self.setRowCount(len(items))
            for row, item in enumerate(items):
                self._set_row_data(row, item, warning_map.get(id(item), []))

        self.setUpdatesEnabled(True)
        self.blockSignals(False)

    def _clear_cell_widgets(self) -> None:
        """移除所有 cell widgets"""
        for row in range(self.rowCount()):
            # 移除状态列和操作列的 cell widgets
            for col in (self.COL_STATUS, self.COL_ACTION):
                widget = self.cellWidget(row, col)
                if widget:
                    self.removeCellWidget(row, col)
                    widget.deleteLater()

    def _set_row_data(self, row: int, item: Item, warnings: list[WarningType]) -> None:
        """设置单行数据"""
        src_text = item.get_src()
        dst_text = item.get_dst()

        # 原文列：显示换行符，超宽自动省略
        src_display = (
            src_text.replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\n", self.SYMBOL_NEWLINE)
        )
        src_item = QTableWidgetItem(src_display)
        src_item.setFlags(src_item.flags() & ~Qt.ItemIsEditable)
        src_item.setData(self.ITEM_ROLE, item)
        src_item.setTextAlignment(Qt.AlignVCenter | Qt.AlignLeft)
        self.setItem(row, self.COL_SRC, src_item)

        # 译文列：显示换行符，超宽自动省略
        dst_display = (
            dst_text.replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\n", self.SYMBOL_NEWLINE)
        )
        dst_item = QTableWidgetItem(dst_display)
        dst_item.setTextAlignment(Qt.AlignVCenter | Qt.AlignLeft)
        if self._readonly:
            dst_item.setFlags(dst_item.flags() & ~Qt.ItemIsEditable)
        self.setItem(row, self.COL_DST, dst_item)

        # 状态列
        self._create_status_widget(row, item, warnings)

        # 操作列
        self._create_action_widget(row, item)

    def _create_status_widget(
        self, row: int, item: Item, warnings: list[WarningType]
    ) -> None:
        """创建状态显示组件"""
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
            status_tooltip = f"{Localizer.get().proofreading_page_filter_status}\n{Localizer.get().current_status}{self._get_status_text(status)}"
            status_icon.setToolTip(status_tooltip)
            layout.addWidget(status_icon)

        # 警告图标（有警告才显示）
        if warnings:
            warning_icon = IconWidget(FluentIcon.VPN)
            warning_icon.setFixedSize(16, 16)
            warning_texts = [self._get_warning_text(e) for e in warnings]
            warning_icon.installEventFilter(
                ToolTipFilter(warning_icon, 300, ToolTipPosition.TOP)
            )
            warning_tooltip = f"{Localizer.get().proofreading_page_warning_tooltip_title}\n{Localizer.get().current_status}{' | '.join(warning_texts)}"
            warning_icon.setToolTip(warning_tooltip)
            layout.addWidget(warning_icon)

        self.setCellWidget(row, self.COL_STATUS, widget)

    def _get_status_text(self, status: Base.ProjectStatus) -> str:
        """获取翻译状态的本地化文本"""
        status_texts = {
            Base.ProjectStatus.NONE: Localizer.get().proofreading_page_status_none,
            Base.ProjectStatus.PROCESSED: Localizer.get().proofreading_page_status_processed,
            Base.ProjectStatus.PROCESSED_IN_PAST: Localizer.get().proofreading_page_status_processed_in_past,
            Base.ProjectStatus.ERROR: Localizer.get().proofreading_page_status_error,
        }
        return status_texts.get(status, str(status))

    def _get_warning_text(self, error: WarningType) -> str:
        """获取警告类型的本地化文本"""
        warning_texts = {
            WarningType.KANA: Localizer.get().proofreading_page_warning_kana,
            WarningType.HANGEUL: Localizer.get().proofreading_page_warning_hangeul,
            WarningType.TEXT_PRESERVE: Localizer.get().proofreading_page_warning_text_preserve,
            WarningType.SIMILARITY: Localizer.get().proofreading_page_warning_similarity,
            WarningType.GLOSSARY: Localizer.get().proofreading_page_warning_glossary,
            WarningType.RETRY_THRESHOLD: Localizer.get().proofreading_page_warning_retry,
        }
        return warning_texts.get(error, str(error))

    def _create_action_widget(self, row: int, item: Item) -> None:
        """创建操作按钮"""
        widget = QWidget()
        layout = QHBoxLayout(widget)
        # 右侧留更多内边距，避免与滚动条重叠
        layout.setContentsMargins(4, 4, 16, 4)
        layout.setSpacing(0)
        layout.setAlignment(Qt.AlignCenter)

        btn_action = PillToolButton(FluentIcon.MORE, widget)
        btn_action.setCheckable(False)  # 禁用点亮切换效果
        btn_action.setEnabled(not self._readonly and row not in self._loading_rows)

        def show_menu() -> None:
            menu = RoundMenu(parent=btn_action)

            # 复制原文到译文
            menu.addAction(
                Action(
                    FluentIcon.PASTE,
                    Localizer.get().proofreading_page_copy_src,
                    triggered=lambda checked: self.copy_src_clicked.emit(item),
                )
            )

            # 复制译文到剪贴板
            menu.addAction(
                Action(
                    FluentIcon.COPY,
                    Localizer.get().proofreading_page_copy_dst,
                    triggered=lambda checked: self.copy_dst_clicked.emit(item),
                )
            )

            # 重新翻译
            menu.addAction(
                Action(
                    FluentIcon.SYNC,
                    Localizer.get().proofreading_page_retranslate,
                    triggered=lambda checked: self.retranslate_clicked.emit(item),
                )
            )

            # 重置翻译状态
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().proofreading_page_reset_translation,
                    triggered=lambda checked: self.reset_translation_clicked.emit(item),
                )
            )

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

    def update_row_status(self, row: int, warnings: list[WarningType]) -> None:
        """更新指定行的状态"""
        item = self.get_item_at_row(row)
        if item:
            self._create_status_widget(row, item, warnings)

    def set_row_loading(self, row: int, loading: bool) -> None:
        """设置指定行为加载中状态"""
        if loading:
            self._loading_rows.add(row)
        else:
            self._loading_rows.discard(row)

        widget = self.cellWidget(row, self.COL_ACTION)
        if widget:
            for btn in widget.findChildren(PillToolButton):
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
                for btn in widget.findChildren(PillToolButton):
                    btn.setEnabled(not readonly and row not in self._loading_rows)

    def _on_cell_double_clicked(self, row: int, column: int) -> None:
        """双击弹出编辑对话框"""
        # 只处理原文列和译文列的双击
        if column not in (self.COL_SRC, self.COL_DST):
            return

        # 只读模式下不允许编辑
        if self._readonly:
            return

        item = self.get_item_at_row(row)
        if not item:
            return

        # 弹出编辑对话框
        dialog = TextEditDialog(
            item.get_src(), item.get_dst(), item.get_file_path(), self.window()
        )
        if dialog.exec():
            new_dst = dialog.get_dst_text()
            # 只在内容变化时发出信号
            if new_dst != item.get_dst():
                self.update_row_dst(row, new_dst)
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
            # 显示换行符，超宽自动省略
            dst_display = (
                new_dst.replace("\r\n", "\n")
                .replace("\r", "\n")
                .replace("\n", self.SYMBOL_NEWLINE)
            )
            dst_cell.setText(dst_display)

        self.blockSignals(False)

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

    def contextMenuEvent(self, event: QContextMenuEvent) -> None:
        """右键菜单事件"""
        if self._readonly:
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
