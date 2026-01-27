from enum import StrEnum

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPaintEvent
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import PillPushButton
from qfluentwidgets import TogglePushButton
from qfluentwidgets import isDarkTheme


class StatusPillKind(StrEnum):
    INFO = "INFO"
    ERROR = "ERROR"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"


DARK_PALETTE: dict[StatusPillKind, tuple[QColor, QColor, QColor]] = {
    StatusPillKind.INFO: (
        QColor(39, 39, 39),
        QColor(255, 255, 255, 46),
        QColor(255, 255, 255),
    ),
    StatusPillKind.SUCCESS: (
        QColor(57, 61, 27),
        QColor(255, 255, 255, 46),
        QColor(255, 255, 255),
    ),
    StatusPillKind.WARNING: (
        QColor(67, 53, 25),
        QColor(255, 255, 255, 46),
        QColor(255, 255, 255),
    ),
    StatusPillKind.ERROR: (
        QColor(68, 39, 38),
        QColor(255, 255, 255, 46),
        QColor(255, 255, 255),
    ),
}

LIGHT_PALETTE: dict[StatusPillKind, tuple[QColor, QColor, QColor]] = {
    StatusPillKind.INFO: (
        QColor(244, 244, 244),
        QColor(229, 229, 229),
        QColor(0, 0, 0),
    ),
    StatusPillKind.SUCCESS: (
        QColor(223, 246, 221),
        QColor(229, 229, 229),
        QColor(0, 0, 0),
    ),
    StatusPillKind.WARNING: (
        QColor(255, 244, 206),
        QColor(229, 229, 229),
        QColor(0, 0, 0),
    ),
    StatusPillKind.ERROR: (
        QColor(253, 231, 233),
        QColor(229, 229, 229),
        QColor(0, 0, 0),
    ),
}


class StatusPillButton(PillPushButton):
    """状态胶囊按钮。

    WHY: 统一封装状态 pill 的样式与类型，避免散落的魔术字符串与 paintEvent hack。
    """

    def __init__(
        self,
        text: str = "",
        kind: StatusPillKind = StatusPillKind.INFO,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setText(text)

        self.kind_value = kind

        # WHY: Status pill 是展示用的标签，不应响应点击。
        self.setEnabled(False)
        self.setCheckable(False)
        self.setCursor(Qt.CursorShape.ArrowCursor)

        # WHY: 默认与旧实现保持一致，避免 UI 体感变化。
        self.font_size_px_value: int | None = None

    def kind(self) -> StatusPillKind:
        return self.kind_value

    def set_kind(self, kind: StatusPillKind) -> None:
        if self.kind_value == kind:
            return
        self.kind_value = kind
        self.update()

    def font_size_px(self) -> int | None:
        return self.font_size_px_value

    def set_font_size_px(self, size_px: int | None) -> None:
        if size_px is not None and size_px <= 0:
            size_px = None

        if self.font_size_px_value == size_px:
            return

        self.font_size_px_value = size_px
        self.update()

    def paintEvent(self, e: QPaintEvent) -> None:
        painter = QPainter(self)
        painter.setRenderHints(QPainter.Antialiasing)

        # WHY: 颜色与 InfoBar 一致，确保全局视觉统一。
        palette = DARK_PALETTE if isDarkTheme() else LIGHT_PALETTE

        bg, border, text_color = palette.get(
            self.kind_value,
            palette[StatusPillKind.INFO],
        )

        rect = self.rect().adjusted(1, 1, -1, -1)
        radius = rect.height() / 2
        painter.setPen(border)
        painter.setBrush(bg)
        painter.drawRoundedRect(rect, radius, radius)

        # WHY: 背景由我们绘制；文字/图标绘制复用库实现，减少维护。
        font_size = self.font_size_px_value
        font_size_qss = f"font-size: {font_size}px;" if font_size else ""

        self.setStyleSheet(
            "PillPushButton { background: transparent; border: none; }"
            f"PillPushButton {{ color: {text_color.name()}; {font_size_qss} padding: 4px 8px; }}"
        )

        TogglePushButton.paintEvent(self, e)
