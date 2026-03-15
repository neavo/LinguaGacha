from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Callable
from typing import Generic
from typing import TypeVar

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtGui import QPixmap

RowT = TypeVar("RowT")


@dataclass(frozen=True, slots=True)
class ColumnSpec(Generic[RowT]):
    class WidthMode(StrEnum):
        STRETCH = "stretch"
        FIXED = "fixed"

    header: str
    width_mode: WidthMode = WidthMode.STRETCH
    width: int = 0
    alignment: Qt.Alignment | Qt.AlignmentFlag = (
        Qt.Alignment(Qt.AlignmentFlag.AlignVCenter) | Qt.AlignmentFlag.AlignLeft
    )

    display_getter: Callable[[RowT], str] | None = None
    tooltip_getter: Callable[[RowT], str] | None = None
    decoration_getter: Callable[[RowT], QIcon | QPixmap | None] | None = None

    editable: bool = False
    set_value: Callable[[RowT, object], bool] | None = None

    def get_display(self, row: RowT) -> str:
        if self.display_getter is None:
            return ""
        value = self.display_getter(row)
        return value if isinstance(value, str) else str(value)

    def get_tooltip(self, row: RowT) -> str:
        if self.tooltip_getter is None:
            return ""
        value = self.tooltip_getter(row)
        return value if isinstance(value, str) else str(value)

    def get_decoration(self, row: RowT) -> QIcon | QPixmap | None:
        if self.decoration_getter is None:
            return None
        return self.decoration_getter(row)
