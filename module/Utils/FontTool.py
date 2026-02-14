from __future__ import annotations

from PySide6.QtGui import QFont
from PySide6.QtGui import QGuiApplication


class FontTool:
    """字体尺寸工具。

    设计背景：
    - QFont.setPixelSize() 会让 pointSize() 变成 -1。
    - 部分三方组件/样式逻辑会依赖 pointSize() 并进一步调用 setPointSize(pointSize())。
      在 Qt6 下这会触发 `QFont::setPointSize: Point size <= 0 (-1)` 的警告刷屏。

    这里统一把“期望的像素字号”换算成 point size 写入字体，既保持视觉尺寸稳定，
    也避免 pointSize() 为 -1。
    """

    DEFAULT_DPI: float = 96.0

    @classmethod
    def set_font_size_px(cls, font: QFont, px: int) -> None:
        px = int(px)
        if px <= 0:
            return

        dpi = cls.get_logical_dpi()
        pt = max(1.0, px * 72.0 / max(1.0, dpi))
        font.setPointSizeF(float(pt))

    @classmethod
    def get_logical_dpi(cls) -> float:
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            return cls.DEFAULT_DPI

        try:
            dpi = float(screen.logicalDotsPerInch())
        except TypeError, RuntimeError:
            return cls.DEFAULT_DPI

        return dpi if dpi > 0 else cls.DEFAULT_DPI
