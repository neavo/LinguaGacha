from enum import StrEnum
from typing import Any
from typing import cast

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPaintEvent
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import PillPushButton
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig


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

    def __init__(  # pyright: ignore[reportIncompatibleMethodOverride]
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

        # WHY: 缓存颜色，避免在 paintEvent 中重复查表。
        self.bg_color = QColor()
        self.border_color = QColor()
        self.text_color = QColor()

        # WHY: 在初始化时捕获基础字体，避免主题切换时 self.font() 被 qfluentwidgets 修改。
        self.base_font = QFont(self.font())
        self.cached_font: QFont | None = None

        self.update_style()
        qconfig.themeChanged.connect(self.update_style)
        cast(Any, self).destroyed.connect(self.disconnect_style_signals)

    def disconnect_style_signals(self) -> None:
        try:
            qconfig.themeChanged.disconnect(self.update_style)
        except (TypeError, RuntimeError):
            pass

    def update_style(self) -> None:
        palette = DARK_PALETTE if isDarkTheme() else LIGHT_PALETTE
        bg, border, text_color = palette.get(
            self.kind_value,
            palette[StatusPillKind.INFO],
        )

        self.bg_color = bg
        self.border_color = border
        self.text_color = text_color

        # WHY: 基于初始化时捕获的 base_font 构建字体，避免主题切换导致字体变化。
        font = QFont(self.base_font)
        font_size = self.font_size_px_value
        if font_size:
            font.setPixelSize(font_size)
        self.cached_font = font

        # WHY: 清空 QSS，完全由 paintEvent 控制外观。
        self.setStyleSheet("")

        self.update()

    def kind(self) -> StatusPillKind:
        return self.kind_value

    def set_kind(self, kind: StatusPillKind) -> None:
        if self.kind_value == kind:
            return
        self.kind_value = kind
        self.update_style()

    def font_size_px(self) -> int | None:
        return self.font_size_px_value

    def set_font_size_px(self, size_px: int | None) -> None:
        if size_px is not None and size_px <= 0:
            size_px = None

        if self.font_size_px_value == size_px:
            return

        self.font_size_px_value = size_px
        self.update_style()

    def paintEvent(self, e: QPaintEvent) -> None:
        del e
        # WHY: 完全自绘，不调用任何父类的 paintEvent，避免 QPushButton 绘制默认灰色背景。
        painter = QPainter(self)
        painter.setRenderHints(QPainter.RenderHint.Antialiasing)

        rect = self.rect().adjusted(1, 1, -1, -1)

        painter.setPen(self.border_color)
        painter.setBrush(self.bg_color)

        # WHY: 圆角半径 = 高度的一半，实现完美药丸形状。
        r = rect.height() / 2
        painter.drawRoundedRect(rect, r, r)

        # WHY: 自绘文本，使用缓存的字体和颜色。
        if self.cached_font:
            painter.setFont(self.cached_font)
        painter.setPen(self.text_color)
        painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, self.text())
