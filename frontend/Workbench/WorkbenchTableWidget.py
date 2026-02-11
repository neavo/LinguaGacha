from typing import Any
from typing import cast

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QContextMenuEvent
from PyQt5.QtGui import QFontMetrics
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget
from qfluentwidgets import TransparentToolButton
from qfluentwidgets import getFont
from qfluentwidgets import setCustomStyleSheet

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer

ICON_ROW_ACTIONS: BaseIcon = BaseIcon.CIRCLE_ELLIPSIS
ICON_MENU_UPDATE: BaseIcon = BaseIcon.REFRESH_CW
ICON_MENU_RESET: BaseIcon = BaseIcon.ROTATE_CCW
ICON_MENU_DELETE: BaseIcon = BaseIcon.TRASH_2


class WorkbenchTableWidget(TableWidget):
    """工作台文件列表专用表格"""

    COL_FILE = 0
    COL_FORMAT = 1
    COL_LINES = 2
    COL_ACTIONS = 3

    FONT_SIZE = 12
    ROW_HEIGHT = 40
    COL_FORMAT_WIDTH = 180
    COL_LINES_WIDTH = 80
    COL_ACTIONS_WIDTH = 60
    ROW_NUMBER_MIN_WIDTH = 40

    # Qt.UserRole 常量在 stubs 中可能缺失，这里直接使用其数值以保证类型检查通过。
    ITEM_ROLE = 0x0100 + 1

    update_clicked = pyqtSignal(str)
    reset_clicked = pyqtSignal(str)
    delete_clicked = pyqtSignal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        self.readonly = False
        self.action_buttons: list[TransparentToolButton] = []

        self.ui_font = getFont(self.FONT_SIZE)
        self.ui_font.setHintingPreference(self.font().hintingPreference())

        header_qss = (
            "QHeaderView::section {\n"
            f"    font: {self.FONT_SIZE}px --FontFamilies;\n"
            "}\n"
        )
        setCustomStyleSheet(self, header_qss, header_qss)

        self.setColumnCount(4)
        self.setHorizontalHeaderLabels(
            [
                Localizer.get().workbench_col_file_path,
                Localizer.get().workbench_col_format,
                Localizer.get().workbench_col_line_count,
                Localizer.get().workbench_col_actions,
            ]
        )

        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.setSelectRightClickedRow(True)
        self.setAlternatingRowColors(True)

        self.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setWordWrap(False)
        self.setTextElideMode(Qt.TextElideMode.ElideRight)
        self.setBorderVisible(False)

        v_header = cast(QHeaderView, self.verticalHeader())
        v_header.setVisible(True)
        v_header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        v_header.setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        v_header.setDefaultSectionSize(self.ROW_HEIGHT)
        v_header.setMinimumSectionSize(self.ROW_HEIGHT)
        v_header.setFixedWidth(self.ROW_NUMBER_MIN_WIDTH)

        header = cast(QHeaderView, self.horizontalHeader())
        header.setSectionResizeMode(self.COL_FILE, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(self.COL_FORMAT, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(self.COL_LINES, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(self.COL_ACTIONS, QHeaderView.ResizeMode.Fixed)
        header.setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)

        self.setColumnWidth(self.COL_FORMAT, self.COL_FORMAT_WIDTH)
        self.setColumnWidth(self.COL_LINES, self.COL_LINES_WIDTH)
        self.setColumnWidth(self.COL_ACTIONS, self.COL_ACTIONS_WIDTH)

    def set_readonly(self, readonly: bool) -> None:
        self.readonly = readonly
        for btn in self.action_buttons:
            btn.setEnabled(not readonly)

    def clear_cell_widgets(self) -> None:
        for row in range(self.rowCount()):
            widget = self.cellWidget(row, self.COL_ACTIONS)
            if widget is None:
                continue
            self.removeCellWidget(row, self.COL_ACTIONS)
            widget.deleteLater()
        self.action_buttons = []

    def set_entries(
        self,
        entries: list[dict[str, Any]],
        *,
        start_index: int = 0,
        fixed_rows: int = 8,
    ) -> None:
        self.blockSignals(True)
        self.setUpdatesEnabled(False)

        self.clear_cell_widgets()
        self.clearContents()

        row_count = max(fixed_rows, len(entries), 1)
        self.setRowCount(row_count)

        labels: list[str] = []
        for row in range(row_count):
            if row < len(entries):
                rel_path = str(entries[row].get("rel_path", ""))
                fmt = str(entries[row].get("format", ""))
                lines = entries[row].get("item_count", 0)
                lines = int(lines) if isinstance(lines, int) else 0
                self.set_row_data(row, rel_path, fmt, lines)
                labels.append(str(start_index + row + 1))
            else:
                # 占位行：保持表格高度与交互一致
                for col in range(self.columnCount()):
                    cell = QTableWidgetItem("")
                    cell.setFont(self.ui_font)
                    cell.setFlags(Qt.ItemFlag.ItemIsEnabled)
                    self.setItem(row, col, cell)
                labels.append("")

        self.set_vertical_header_labels(labels)
        self.update_row_number_width(start_index + len(entries))

        self.setUpdatesEnabled(True)
        self.blockSignals(False)

    def set_row_data(self, row: int, rel_path: str, fmt: str, lines: int) -> None:
        file_item = QTableWidgetItem(rel_path)
        file_item.setFont(self.ui_font)
        file_item.setFlags(cast(Any, file_item.flags() & ~Qt.ItemFlag.ItemIsEditable))
        file_item.setData(self.ITEM_ROLE, rel_path)
        file_item.setTextAlignment(
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
        )
        file_item.setToolTip(rel_path)
        self.setItem(row, self.COL_FILE, file_item)

        fmt_item = QTableWidgetItem(fmt)
        fmt_item.setFont(self.ui_font)
        fmt_item.setFlags(cast(Any, fmt_item.flags() & ~Qt.ItemFlag.ItemIsEditable))
        fmt_item.setTextAlignment(
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
        )
        self.setItem(row, self.COL_FORMAT, fmt_item)

        lines_item = QTableWidgetItem(str(lines))
        lines_item.setFont(self.ui_font)
        lines_item.setFlags(cast(Any, lines_item.flags() & ~Qt.ItemFlag.ItemIsEditable))
        lines_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setItem(row, self.COL_LINES, lines_item)

        # 保留一个 item，让整行选择高亮覆盖到 actions 列
        actions_item = QTableWidgetItem("")
        actions_item.setFont(self.ui_font)
        actions_item.setFlags(
            cast(Any, actions_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
        )
        actions_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setItem(row, self.COL_ACTIONS, actions_item)

        self.create_actions_widget(row, rel_path)

    def create_actions_widget(self, row: int, rel_path: str) -> None:
        widget = QWidget(self)
        widget.setFixedHeight(self.ROW_HEIGHT)
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        btn = TransparentToolButton(ICON_ROW_ACTIONS, widget)
        btn.setFixedSize(28, 28)
        btn.setEnabled(not self.readonly)
        btn.clicked.connect(lambda: self.open_actions_menu(rel_path, btn))
        self.action_buttons.append(btn)

        layout.addWidget(btn)
        self.setCellWidget(row, self.COL_ACTIONS, widget)

    def open_actions_menu(self, rel_path: str, anchor: QWidget) -> None:
        if self.readonly:
            return

        menu = RoundMenu(parent=self)
        menu.addAction(
            Action(
                ICON_MENU_UPDATE,
                Localizer.get().workbench_btn_update,
                triggered=lambda checked: self.update_clicked.emit(rel_path),
            )
        )
        menu.addAction(
            Action(
                ICON_MENU_RESET,
                Localizer.get().workbench_btn_reset,
                triggered=lambda checked: self.reset_clicked.emit(rel_path),
            )
        )
        menu.addSeparator()
        menu.addAction(
            Action(
                ICON_MENU_DELETE,
                Localizer.get().workbench_btn_delete,
                triggered=lambda checked: self.delete_clicked.emit(rel_path),
            )
        )

        pos = anchor.mapToGlobal(QPoint(anchor.width() + 8, 0))
        menu.exec(pos)

    def get_selected_row(self) -> int:
        rows = sorted({index.row() for index in self.selectedIndexes()})
        return rows[0] if rows else -1

    def get_rel_path_at_row(self, row: int) -> str:
        cell = self.item(row, self.COL_FILE)
        if cell is None:
            return ""
        value = cell.data(self.ITEM_ROLE)
        return str(value) if isinstance(value, str) else ""

    def contextMenuEvent(self, a0: QContextMenuEvent | None) -> None:
        if a0 is None:
            return
        if self.readonly:
            return

        clicked = self.itemAt(a0.pos())
        if clicked is not None:
            row = clicked.row()
            selected_rows = {index.row() for index in self.selectedIndexes()}
            if row not in selected_rows:
                self.selectRow(row)

        row = self.get_selected_row()
        if row < 0:
            return
        rel_path = self.get_rel_path_at_row(row)
        if not rel_path:
            return

        menu = RoundMenu(parent=self)
        menu.addAction(
            Action(
                ICON_MENU_UPDATE,
                Localizer.get().workbench_btn_update,
                triggered=lambda checked: self.update_clicked.emit(rel_path),
            )
        )
        menu.addAction(
            Action(
                ICON_MENU_RESET,
                Localizer.get().workbench_btn_reset,
                triggered=lambda checked: self.reset_clicked.emit(rel_path),
            )
        )
        menu.addSeparator()
        menu.addAction(
            Action(
                ICON_MENU_DELETE,
                Localizer.get().workbench_btn_delete,
                triggered=lambda checked: self.delete_clicked.emit(rel_path),
            )
        )
        menu.exec(a0.globalPos())

    def get_selected_rel_path(self) -> str:
        row = self.get_selected_row()
        if row < 0:
            return ""
        return self.get_rel_path_at_row(row)

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
