from __future__ import annotations

from typing import Any

from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QContextMenuEvent
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer
from widget.AppTable import AppTableModelBase
from widget.AppTable import AppTableView
from widget.AppTable import ColumnSpec
from widget.AppTable.ActionMenuDelegate import ActionMenuDelegate
from widget.AppTable.ActionMenuDelegate import ActionSpec

ICON_MENU_UPDATE: BaseIcon = BaseIcon.REFRESH_CW
ICON_MENU_RESET: BaseIcon = BaseIcon.ROTATE_CCW
ICON_MENU_DELETE: BaseIcon = BaseIcon.TRASH_2


class WorkbenchTableWidget(AppTableView):
    """工作台文件列表专用表格（AppTable）。"""

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

    update_clicked = pyqtSignal(str)
    reset_clicked = pyqtSignal(str)
    delete_clicked = pyqtSignal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)

        self.column_specs: list[ColumnSpec[dict[str, Any]]] = [
            ColumnSpec(
                header=Localizer.get().workbench_col_file_path,
                width_mode=ColumnSpec.WidthMode.STRETCH,
                alignment=Qt.Alignment(Qt.AlignmentFlag.AlignVCenter)
                | Qt.AlignmentFlag.AlignLeft,
                display_getter=lambda row: str(row.get("rel_path", "")),
                tooltip_getter=lambda row: str(row.get("rel_path", "")),
            ),
            ColumnSpec(
                header=Localizer.get().workbench_col_format,
                width_mode=ColumnSpec.WidthMode.FIXED,
                width=self.COL_FORMAT_WIDTH,
                alignment=Qt.Alignment(Qt.AlignmentFlag.AlignVCenter)
                | Qt.AlignmentFlag.AlignLeft,
                display_getter=lambda row: str(row.get("format", "")),
            ),
            ColumnSpec(
                header=Localizer.get().workbench_col_line_count,
                width_mode=ColumnSpec.WidthMode.FIXED,
                width=self.COL_LINES_WIDTH,
                alignment=Qt.AlignmentFlag.AlignCenter,
                display_getter=lambda row: str(row.get("item_count", 0)),
            ),
            ColumnSpec(
                header=Localizer.get().workbench_col_actions,
                width_mode=ColumnSpec.WidthMode.FIXED,
                width=self.COL_ACTIONS_WIDTH,
                alignment=Qt.AlignmentFlag.AlignCenter,
                display_getter=lambda row: "",
            ),
        ]

        self.table_model: AppTableModelBase[dict[str, Any]] = AppTableModelBase(
            self.ui_font,
            self.column_specs,
            row_key_getter=self.get_row_key,
            parent=self,
        )
        self.setModel(self.table_model)
        self.apply_column_specs(self.column_specs)
        self.update_row_number_width(0)

        self.action_delegate = ActionMenuDelegate(
            self,
            actions_provider=self.get_action_specs,
            is_readonly=lambda: self.readonly,
        )
        self.setItemDelegateForColumn(self.COL_ACTIONS, self.action_delegate)

    @staticmethod
    def get_row_key(row: dict[str, Any]) -> str:
        value = row.get("rel_path", "")
        return value if isinstance(value, str) else str(value)

    def set_entries(
        self,
        entries: list[dict[str, Any]],
        *,
        start_index: int = 0,
        fixed_rows: int | None = None,
    ) -> None:
        if fixed_rows is None:
            self.table_model.set_rows(entries, start_index=start_index)
        else:
            self.table_model.set_rows(
                entries, min_rows=fixed_rows, start_index=start_index
            )
        self.update_row_number_width(start_index + len(entries))

    def get_selected_rel_path(self) -> str:
        key = self.get_selected_row_key()
        return key if isinstance(key, str) else ""

    def get_rel_path_at_row(self, row: int) -> str:
        obj = self.table_model.row_object(row)
        if obj is None:
            return ""
        value = obj.get("rel_path", "")
        return value if isinstance(value, str) else str(value)

    def get_action_specs(self, index) -> list[ActionSpec]:  # noqa: ANN001
        rel_path = self.get_rel_path_at_row(index.row())
        if not rel_path:
            return []
        return [
            ActionSpec(
                text=Localizer.get().workbench_btn_update,
                icon=ICON_MENU_UPDATE,
                triggered=lambda: self.update_clicked.emit(rel_path),
            ),
            ActionSpec(
                text=Localizer.get().workbench_btn_reset,
                icon=ICON_MENU_RESET,
                triggered=lambda: self.reset_clicked.emit(rel_path),
            ),
            ActionSpec(separator=True),
            ActionSpec(
                text=Localizer.get().workbench_btn_delete,
                icon=ICON_MENU_DELETE,
                triggered=lambda: self.delete_clicked.emit(rel_path),
            ),
        ]

    def contextMenuEvent(self, a0: QContextMenuEvent | None) -> None:  # noqa: N802
        if a0 is None:
            return
        if self.readonly:
            return

        row = self.select_row_at_global_pos(a0.globalPos())
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
