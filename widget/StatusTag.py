from enum import StrEnum
from typing import Any
from typing import cast

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QFontMetrics
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPaintEvent
from PyQt5.QtWidgets import QLabel
from PyQt5.QtWidgets import QSizePolicy
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig


class StatusPillKind(StrEnum):
    INFO = "INFO"
    ERROR = "ERROR"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"


DARK_PALETTE: dict[StatusPillKind, tuple[QColor, QColor, QColor]] = {
    StatusPillKind.INFO: (
        QColor(56, 139, 253, 26),  # Bg (Blue)
        QColor(56, 139, 253, 102),  # Border
        QColor(230, 230, 230),  # Text
    ),
    StatusPillKind.SUCCESS: (
        QColor(46, 160, 67, 26),  # Bg (Green)
        QColor(46, 160, 67, 102),  # Border
        QColor(230, 230, 230),  # Text
    ),
    StatusPillKind.WARNING: (
        QColor(187, 128, 9, 26),  # Bg (Yellow)
        QColor(187, 128, 9, 102),  # Border
        QColor(230, 230, 230),  # Text
    ),
    StatusPillKind.ERROR: (
        QColor(248, 81, 73, 26),  # Bg (Red)
        QColor(248, 81, 73, 102),  # Border
        QColor(230, 230, 230),  # Text
    ),
}

LIGHT_PALETTE: dict[StatusPillKind, tuple[QColor, QColor, QColor]] = {
    StatusPillKind.INFO: (
        QColor(221, 244, 255),  # Bg (Blue)
        QColor(84, 174, 255),  # Border
        QColor(88, 88, 88),  # Text
    ),
    StatusPillKind.SUCCESS: (
        QColor(218, 251, 225),  # Bg (Green)
        QColor(74, 194, 107),  # Border
        QColor(88, 88, 88),  # Text
    ),
    StatusPillKind.WARNING: (
        QColor(255, 248, 197),  # Bg (Yellow)
        QColor(212, 167, 44),  # Border
        QColor(88, 88, 88),  # Text
    ),
    StatusPillKind.ERROR: (
        QColor(255, 235, 233),  # Bg (Red)
        QColor(255, 129, 130),  # Border
        QColor(88, 88, 88),  # Text
    ),
}


class StatusTag(QLabel):
    """状态胶囊标签。

    WHY: 统一封装状态 pill 的样式与类型，避免散落的魔术字符串与 paintEvent hack。
    """

    def __init__(
        self,
        text: str = "",
        kind: StatusPillKind = StatusPillKind.INFO,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(text, parent)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)

        self.kind_value = kind

        # 默认与旧实现保持一致，避免 UI 体感变化。
        self.font_size_px_value: int | None = None

        # 缓存颜色，避免在 paintEvent 中重复查表。
        self.bg_color = QColor()
        self.border_color = QColor()
        self.text_color = QColor()

        # 在初始化时捕获基础字体，避免主题切换时 self.font() 被 qfluentwidgets 修改。
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

        # 基于初始化时捕获的 base_font 构建字体，避免主题切换导致字体变化。
        font = QFont(self.base_font)
        font_size = self.font_size_px_value
        if font_size:
            font.setPixelSize(font_size)
        self.cached_font = font
        self.setFont(font)

        # 清空 QSS，完全由 paintEvent 控制外观。
        self.setStyleSheet("")

        self.setFixedSize(self.sizeHint())
        self.update()
        self.updateGeometry()

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

    def setText(self, a0: str | None) -> None:
        text = a0 or ""
        if self.text() == text:
            return
        super().setText(text)
        # 强制设置固定尺寸，确保 FlowLayout 能够正确计算布局。
        hint = self.sizeHint()
        self.setFixedSize(hint)
        parent = self.parentWidget()
        if parent is None:
            return
        layout = parent.layout()
        if layout is not None:
            layout.invalidate()

    def minimumSizeHint(self) -> QSize:
        return self.sizeHint()

    def sizeHint(self) -> QSize:
        """计算标签的合适尺寸。

        WHY: 圆角矩形，预留左右内边距。
        """
        fm = QFontMetrics(self.font())
        text = self.text()
        text_w = fm.horizontalAdvance(text)
        text_h = fm.height()

        # 垂直方向增加少量 padding
        height = text_h + 8

        # 水平方向：文本宽度 + 左右内边距 (各 8px)
        width = text_w + 16

        return QSize(width, height)

    def paintEvent(self, a0: QPaintEvent | None) -> None:
        del a0
        # 完全自绘，避免 QLabel 默认绘制。
        painter = QPainter(self)
        painter.setRenderHints(QPainter.RenderHint.Antialiasing)

        rect = self.rect().adjusted(1, 1, -1, -1)

        painter.setPen(self.border_color)
        painter.setBrush(self.bg_color)

        # 固定圆角半径，实现圆角矩形。
        r = 4
        painter.drawRoundedRect(rect, r, r)

        # 自绘文本，使用缓存的字体和颜色。
        if self.cached_font:
            painter.setFont(self.cached_font)
        painter.setPen(self.text_color)
        painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, self.text())
