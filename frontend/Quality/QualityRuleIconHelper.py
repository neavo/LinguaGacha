from __future__ import annotations

import dataclasses

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPixmap
from qfluentwidgets import FluentIcon
from qfluentwidgets import TableItemDelegate
from qfluentwidgets import isDarkTheme
from qfluentwidgets import themeColor


@dataclasses.dataclass(frozen=True)
class RuleIconSpec:
    icon: FluentIcon
    enabled: bool


class QualityRuleIconDelegate(TableItemDelegate):
    """保持表格交互样式的同时绘制规则图标。"""

    def __init__(self, parent, icon_column_index: int, icon_size: int) -> None:
        super().__init__(parent)
        self.icon_column_index = icon_column_index
        self.icon_size = icon_size

    def paint(self, painter, option, index) -> None:
        if index.column() != self.icon_column_index:
            super().paint(painter, option, index)
            return

        painter.save()
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        painter.setClipping(True)
        painter.setClipRect(option.rect)

        option.rect.adjust(0, self.margin, 0, -self.margin)

        is_hover = self.hoverRow == index.row()
        is_pressed = self.pressedRow == index.row()
        table = self.parent()
        alternating_fn = getattr(table, "alternatingRowColors", None)
        alternating = bool(alternating_fn()) if callable(alternating_fn) else False
        is_alternate = index.row() % 2 == 0 and alternating
        is_dark = isDarkTheme()

        c = 255 if is_dark else 0
        alpha = 0

        if index.row() not in self.selectedRows:
            if is_pressed:
                alpha = 9 if is_dark else 6
            elif is_hover:
                alpha = 12
            elif is_alternate:
                alpha = 5
        else:
            if is_pressed:
                alpha = 15 if is_dark else 9
            elif is_hover:
                alpha = 25
            else:
                alpha = 17

        if index.data(Qt.ItemDataRole.BackgroundRole):
            painter.setBrush(index.data(Qt.ItemDataRole.BackgroundRole))
        else:
            painter.setBrush(QColor(c, c, c, alpha))

        self._drawBackground(painter, option, index)
        painter.restore()

        decoration = index.data(Qt.ItemDataRole.DecorationRole)
        if not isinstance(decoration, QPixmap):
            return

        rect = option.rect
        dpr = decoration.devicePixelRatio()
        icon_width = int(decoration.width() / dpr)
        icon_height = int(decoration.height() / dpr)
        x = rect.x() + (rect.width() - icon_width) // 2
        y = rect.y() + (rect.height() - icon_height) // 2
        painter.drawPixmap(x, y, decoration)


class QualityRuleIconRenderer:
    def __init__(
        self,
        icon_size: int,
        inner_size: int,
        border_width: int,
        luma_threshold: float,
        icon_spacing: int,
    ) -> None:
        self.icon_size = icon_size
        self.inner_size = inner_size
        self.border_width = border_width
        self.luma_threshold = luma_threshold
        self.icon_spacing = icon_spacing
        self.cache: dict[tuple[bool, int, tuple[tuple[str, bool], ...]], QPixmap] = {}

    def clear_cache(self) -> None:
        self.cache.clear()

    def get_pixmap(
        self, table, icons: list[RuleIconSpec] | tuple[RuleIconSpec, ...]
    ) -> QPixmap | None:
        if not icons:
            return None

        is_dark = isDarkTheme()
        try:
            dpr = float(table.devicePixelRatioF())
        except Exception:
            dpr = 1.0

        key = (
            is_dark,
            int(round(dpr * 100)),
            tuple((spec.icon.name, spec.enabled) for spec in icons),
        )
        cached = self.cache.get(key)
        if cached is not None:
            return cached

        pixmap = self.build_icon_strip(icons, is_dark, dpr)
        self.cache[key] = pixmap
        return pixmap

    def build_icon_strip(
        self,
        icons: list[RuleIconSpec] | tuple[RuleIconSpec, ...],
        is_dark: bool,
        dpr: float,
    ) -> QPixmap:
        size_px = max(1, int(round(self.icon_size * dpr)))
        spacing_px = max(1, int(round(self.icon_spacing * dpr)))
        total_width = size_px * len(icons) + spacing_px * (len(icons) - 1)

        # 使用物理像素绘制，避免 DPR 影响坐标。
        pixmap = QPixmap(total_width, size_px)
        pixmap.fill(Qt.GlobalColor.transparent)

        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        x = 0
        for spec in icons:
            icon_pixmap = self.build_single_icon_pixmap(
                spec.icon, spec.enabled, is_dark, dpr
            )
            painter.drawPixmap(x, 0, icon_pixmap)
            x += size_px + spacing_px

        painter.end()

        try:
            pixmap.setDevicePixelRatio(dpr)
        except Exception:
            pass
        return pixmap

    def build_single_icon_pixmap(
        self, icon: FluentIcon, enabled: bool, is_dark: bool, dpr: float
    ) -> QPixmap:
        size_px = max(1, int(round(self.icon_size * dpr)))
        pixmap = QPixmap(size_px, size_px)
        pixmap.fill(Qt.GlobalColor.transparent)

        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        border_px = max(1, int(round(self.border_width * dpr)))

        if enabled:
            rect = pixmap.rect()
            border_color = Qt.GlobalColor.transparent
            bg_color = QColor(themeColor())
            bg_color.setAlpha(255)
            icon_color = self.pick_contrast_color(bg_color)
        else:
            rect = pixmap.rect().adjusted(border_px, border_px, -border_px, -border_px)
            border_color = QColor(255, 255, 255, 18) if is_dark else QColor(0, 0, 0, 15)
            bg_color = (
                QColor(255, 255, 255, 15) if is_dark else QColor(243, 243, 243, 194)
            )
            icon_color = QColor(255, 255, 255, 170) if is_dark else QColor(0, 0, 0, 140)

        painter.setPen(border_color)
        painter.setBrush(bg_color)
        radius = rect.height() / 2
        painter.drawRoundedRect(rect, radius, radius)

        inner_px = max(1, int(round(self.inner_size * dpr)))
        icon_pixmap = icon.icon().pixmap(inner_px, inner_px)
        icon_pixmap = self.tint_pixmap(icon_pixmap, icon_color)
        offset_px = (size_px - inner_px) // 2
        painter.drawPixmap(offset_px, offset_px, icon_pixmap)
        painter.end()
        return pixmap

    def tint_pixmap(self, base: QPixmap, color: QColor) -> QPixmap:
        tinted = QPixmap(base.size())
        tinted.fill(Qt.GlobalColor.transparent)

        painter = QPainter(tinted)
        painter.setCompositionMode(QPainter.CompositionMode_Source)
        painter.drawPixmap(0, 0, base)
        painter.setCompositionMode(QPainter.CompositionMode_SourceIn)
        painter.fillRect(tinted.rect(), color)
        painter.end()
        return tinted

    def pick_contrast_color(self, color: QColor) -> QColor:
        luma = 0.2126 * color.redF() + 0.7152 * color.greenF() + 0.0722 * color.blueF()
        if luma > self.luma_threshold:
            return QColor(0, 0, 0)
        return QColor(255, 255, 255)
