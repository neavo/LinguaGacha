from __future__ import annotations

import dataclasses
from types import MappingProxyType
from typing import Any
from typing import Callable
from typing import Generic
from typing import TypeVar
from typing import cast

from PySide6.QtCore import QAbstractTableModel
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QObject
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont

from widget.AppTable.ColumnSpec import ColumnSpec

RowT = TypeVar("RowT")


class AppTableModelBase(QAbstractTableModel, Generic[RowT]):
    DEFAULT_MIN_ROWS: int = 20

    # Qt.UserRole 常量在 stubs 中可能缺失，这里直接使用其数值以保证类型检查通过。
    USER_ROLE_BASE: int = 0x0100
    ROW_OBJECT_ROLE: int = USER_ROLE_BASE + 1
    PLACEHOLDER_ROLE: int = USER_ROLE_BASE + 2
    ROW_KEY_ROLE: int = USER_ROLE_BASE + 3

    def __init__(
        self,
        ui_font: QFont,
        columns: list[ColumnSpec[RowT]] | None = None,
        *,
        row_key_getter: Callable[[RowT], object] | None = None,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self.ui_font = ui_font
        self.columns: list[ColumnSpec[RowT]] = list(columns) if columns else []
        self.rows: list[RowT] = []
        self.min_rows: int = self.DEFAULT_MIN_ROWS
        self.start_index: int = 0
        self.readonly: bool = False
        self.row_key_getter: Callable[[RowT], object] = (
            row_key_getter if row_key_getter is not None else lambda row: id(row)
        )
        self.row_by_key: dict[object, int] = {}

    def set_columns(self, columns: list[ColumnSpec[RowT]]) -> None:
        self.beginResetModel()
        self.columns = list(columns)
        self.endResetModel()

    def set_rows(
        self,
        rows: list[RowT],
        *,
        min_rows: int | None = None,
        start_index: int | None = None,
    ) -> None:
        self.beginResetModel()
        self.rows = list(rows)
        # 约定：默认保持固定占位行数，避免各页面重复计算。
        self.min_rows = (
            self.DEFAULT_MIN_ROWS if min_rows is None else max(0, int(min_rows))
        )
        if start_index is not None:
            self.start_index = max(0, int(start_index))

        self.row_by_key = {}
        for i, row in enumerate(self.rows):
            key = self.row_key_getter(row)
            if key in self.row_by_key:
                continue
            self.row_by_key[key] = i
        self.endResetModel()

    def set_start_index(self, start_index: int) -> None:
        value = max(0, int(start_index))
        if value == self.start_index:
            return
        self.start_index = value
        if self.rowCount() > 0:
            self.headerDataChanged.emit(Qt.Orientation.Vertical, 0, self.rowCount() - 1)

    def set_min_rows(self, min_rows: int) -> None:
        value = max(0, int(min_rows))
        if value == self.min_rows:
            return
        self.beginResetModel()
        self.min_rows = value
        self.endResetModel()

    def set_readonly(self, readonly: bool) -> None:
        value = bool(readonly)
        if value == self.readonly:
            return
        self.readonly = value

        if self.rowCount() <= 0 or self.columnCount() <= 0:
            return
        top_left = self.index(0, 0)
        bottom_right = self.index(self.rowCount() - 1, self.columnCount() - 1)
        self.dataChanged.emit(top_left, bottom_right, [])

    def find_row_by_key(self, key: object) -> int:
        row = self.row_by_key.get(key)
        return int(row) if isinstance(row, int) else -1

    def row_object(self, row: int) -> RowT | None:
        if self.is_placeholder_row(row):
            return None
        return self.rows[row]

    def get_row_snapshot(self, row_object: RowT) -> object:
        """返回行对象的不可变快照。

        约束：Qt roles 用于跨层传递信息时，不应直接泄漏可变对象引用。
        - dict: 复制后用 MappingProxyType 包装成只读
        - list/set: 转为 tuple/frozenset
        - dataclass: frozen 直接返回；否则转为 dict 快照
        - 其他类型：默认退化为 row_key（稳定锚点）
        """

        value: object = row_object
        if value is None or isinstance(value, (str, int, float, bool, bytes)):
            return value
        if isinstance(value, dict):
            return MappingProxyType(dict(value))
        if isinstance(value, list):
            return tuple(value)
        if isinstance(value, set):
            return frozenset(value)
        if dataclasses.is_dataclass(value):
            params = getattr(value, "__dataclass_params__", None)
            if params is not None and getattr(params, "frozen", False):
                return value
            return dataclasses.asdict(value)
        return self.row_key_getter(row_object)

    def is_placeholder_row(self, row: int) -> bool:
        return row < 0 or row >= len(self.rows)

    def rowCount(self, parent: QModelIndex = QModelIndex()) -> int:  # noqa: N802
        del parent
        return max(len(self.rows), self.min_rows)

    def columnCount(self, parent: QModelIndex = QModelIndex()) -> int:  # noqa: N802
        del parent
        return len(self.columns)

    def headerData(
        self,
        section: int,
        orientation: Qt.Orientation,
        role: int = Qt.ItemDataRole.DisplayRole,
    ) -> Any:  # noqa: ANN401
        if role != Qt.ItemDataRole.DisplayRole:
            return None

        if orientation == Qt.Orientation.Horizontal:
            if 0 <= section < len(self.columns):
                return self.columns[section].header
            return None

        if self.is_placeholder_row(section):
            return ""
        return str(self.start_index + section + 1)

    def flags(self, index: QModelIndex) -> Qt.ItemFlags:  # noqa: N802
        if not index.isValid():
            return cast(Qt.ItemFlags, Qt.ItemFlag.NoItemFlags)

        if self.is_placeholder_row(index.row()):
            return cast(Qt.ItemFlags, Qt.ItemFlag.ItemIsEnabled)

        flags = Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable

        col = index.column()
        if 0 <= col < len(self.columns):
            spec = self.columns[col]
            if (not self.readonly) and spec.editable and callable(spec.set_value):
                flags = flags | Qt.ItemFlag.ItemIsEditable

        return cast(Qt.ItemFlags, flags)

    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole) -> Any:  # noqa: ANN401, N802
        if not index.isValid():
            return None

        row = index.row()
        col = index.column()
        if col < 0 or col >= len(self.columns):
            return None
        spec = self.columns[col]

        if self.is_placeholder_row(row):
            if role == self.PLACEHOLDER_ROLE:
                return True
            if role == self.ROW_OBJECT_ROLE:
                return None
            if role == self.ROW_KEY_ROLE:
                return None
            if role in (
                int(Qt.ItemDataRole.DisplayRole),
                int(Qt.ItemDataRole.ToolTipRole),
                int(Qt.ItemDataRole.EditRole),
            ):
                return ""
            if role == int(Qt.ItemDataRole.FontRole):
                return self.ui_font
            if role == int(Qt.ItemDataRole.TextAlignmentRole):
                return spec.alignment
            return None

        row_object = self.rows[row]

        if role == self.PLACEHOLDER_ROLE:
            return False
        if role == self.ROW_OBJECT_ROLE:
            return self.get_row_snapshot(row_object)
        if role == self.ROW_KEY_ROLE:
            return self.row_key_getter(row_object)
        if role == int(Qt.ItemDataRole.FontRole):
            return self.ui_font
        if role == int(Qt.ItemDataRole.TextAlignmentRole):
            return spec.alignment
        if role == int(Qt.ItemDataRole.ToolTipRole):
            return spec.get_tooltip(row_object)
        if role == int(Qt.ItemDataRole.DecorationRole):
            return spec.get_decoration(row_object)
        if role in (int(Qt.ItemDataRole.DisplayRole), int(Qt.ItemDataRole.EditRole)):
            return spec.get_display(row_object)
        return None

    def setData(
        self,
        index: QModelIndex,
        value: object,
        role: int = Qt.ItemDataRole.EditRole,
    ) -> bool:  # noqa: N802
        if role != int(Qt.ItemDataRole.EditRole):
            return False
        if not index.isValid():
            return False

        row = index.row()
        col = index.column()
        if self.is_placeholder_row(row):
            return False
        if col < 0 or col >= len(self.columns):
            return False

        spec = self.columns[col]
        if self.readonly or (not spec.editable) or (not callable(spec.set_value)):
            return False

        row_object = self.rows[row]
        ok = spec.set_value(row_object, value)
        if not ok:
            return False

        top_left = self.index(row, 0)
        bottom_right = self.index(row, self.columnCount() - 1)
        self.dataChanged.emit(
            top_left,
            bottom_right,
            [
                int(Qt.ItemDataRole.DisplayRole),
                int(Qt.ItemDataRole.ToolTipRole),
                int(Qt.ItemDataRole.DecorationRole),
            ],
        )
        return True
