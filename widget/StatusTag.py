from enum import StrEnum
from typing import Any
from typing import ClassVar
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


class StatusTagType(StrEnum):
    INFO = "INFO"
    ERROR = "ERROR"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"


class StatusTag(QLabel):
    """状态标签。

    统一封装状态标签（StatusTag）的样式与类型，避免散落的魔术字符串与 paintEvent hack。
    """

    # 配色定义放在类内部，确保该模块不依赖全局可变状态。
    DARK_PALETTE: ClassVar[dict[StatusTagType, tuple[QColor, QColor, QColor]]] = {
        StatusTagType.INFO: (
            QColor(56, 139, 253, 26),  # 背景 (Blue)
            QColor(56, 139, 253, 102),  # 边框
            QColor(230, 230, 230),  # 文本
        ),
        StatusTagType.SUCCESS: (
            QColor(46, 160, 67, 26),  # 背景 (Green)
            QColor(46, 160, 67, 102),  # 边框
            QColor(230, 230, 230),  # 文本
        ),
        StatusTagType.WARNING: (
            QColor(187, 128, 9, 26),  # 背景 (Yellow)
            QColor(187, 128, 9, 102),  # 边框
            QColor(230, 230, 230),  # 文本
        ),
        StatusTagType.ERROR: (
            QColor(248, 81, 73, 26),  # 背景 (Red)
            QColor(248, 81, 73, 102),  # 边框
            QColor(230, 230, 230),  # 文本
        ),
    }

    LIGHT_PALETTE: ClassVar[dict[StatusTagType, tuple[QColor, QColor, QColor]]] = {
        StatusTagType.INFO: (
            QColor(221, 244, 255),  # 背景 (Blue)
            QColor(84, 174, 255),  # 边框
            QColor(88, 88, 88),  # 文本
        ),
        StatusTagType.SUCCESS: (
            QColor(218, 251, 225),  # 背景 (Green)
            QColor(74, 194, 107),  # 边框
            QColor(88, 88, 88),  # 文本
        ),
        StatusTagType.WARNING: (
            QColor(255, 248, 197),  # 背景 (Yellow)
            QColor(212, 167, 44),  # 边框
            QColor(88, 88, 88),  # 文本
        ),
        StatusTagType.ERROR: (
            QColor(255, 235, 233),  # 背景 (Red)
            QColor(255, 129, 130),  # 边框
            QColor(88, 88, 88),  # 文本
        ),
    }

    def __init__(
        self,
        text: str = "",
        type: StatusTagType = StatusTagType.INFO,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(text, parent)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)

        self.type_value = type

        # 默认与旧实现保持一致，避免 UI 体感变化。
        self.font_size_value: int | None = None

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
            # Qt 对象销毁或重复断开连接时可能抛异常，可忽略。
            pass

    def update_style(self) -> None:
        palette = self.DARK_PALETTE if isDarkTheme() else self.LIGHT_PALETTE
        bg, border, text_color = palette.get(
            self.type_value,
            palette[StatusTagType.INFO],
        )

        self.bg_color = bg
        self.border_color = border
        self.text_color = text_color

        # 基于初始化时捕获的 base_font 构建字体，避免主题切换导致字体变化。
        font = QFont(self.base_font)
        font_size = self.font_size_value
        if font_size:
            font.setPixelSize(font_size)
        self.cached_font = font
        self.setFont(font)

        # 清空 QSS，避免样式系统与自绘逻辑互相覆盖。
        self.setStyleSheet("")

        # 固定尺寸是为了让 FlowLayout 的布局计算稳定，不因字体/主题切换产生跳动。
        self.setFixedSize(self.sizeHint())
        self.update()
        self.updateGeometry()

    def type(self) -> StatusTagType:
        return self.type_value

    def set_type(self, type: StatusTagType) -> None:
        if self.type_value == type:
            return
        self.type_value = type
        self.update_style()

    def font_size(self) -> int | None:
        return self.font_size_value

    def set_font_size(self, size: int | None) -> None:
        if size is not None and size <= 0:
            size = None

        if self.font_size_value == size:
            return

        self.font_size_value = size
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

        圆角矩形，预留左右内边距。
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
