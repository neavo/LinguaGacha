from __future__ import annotations

import dataclasses
from typing import Callable
from typing import Optional

from PyQt5.QtCore import QEvent
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QSortFilterProxyModel
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QMouseEvent
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPixmap
from qfluentwidgets import TableItemDelegate
from qfluentwidgets import isDarkTheme
from qfluentwidgets import themeColor

from base.BaseIcon import BaseIcon


@dataclasses.dataclass(frozen=True)
class RuleIconSpec:
    icon: BaseIcon
    enabled: bool


class QualityRuleIconDelegate(TableItemDelegate):
    """保持表格交互样式的同时绘制规则图标。"""

    TOOLTIP_DELAY_MS: int = 300

    def __init__(
        self,
        parent,
        icon_column_index: int,
        icon_size: int,
        *,
        icon_count: int = 1,
        on_icon_clicked: Callable[[int, int], None] | None = None,
    ) -> None:
        super().__init__(parent)
        self.icon_column_index = icon_column_index
        self.icon_size = icon_size
        self.icon_count = max(0, int(icon_count))
        self.on_icon_clicked = on_icon_clicked
        self.tooltipDelegate.setToolTipDelay(self.TOOLTIP_DELAY_MS)

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

    def editorEvent(
        self,
        event: Optional[QEvent],
        model,  # noqa: ANN001
        option,
        index,
    ) -> bool:
        if event is None:
            return False
        if index.column() != self.icon_column_index:
            return super().editorEvent(event, model, option, index)
        if not callable(self.on_icon_clicked):
            return super().editorEvent(event, model, option, index)

        if event.type() != QEvent.Type.MouseButtonRelease:
            return False

        mouse_event = event
        if not isinstance(mouse_event, QMouseEvent):
            return False
        if mouse_event.button() != Qt.MouseButton.LeftButton:
            return False

        placeholder_role = getattr(model, "PLACEHOLDER_ROLE", None)
        if not isinstance(placeholder_role, int) and isinstance(
            model, QSortFilterProxyModel
        ):
            placeholder_role = getattr(model.sourceModel(), "PLACEHOLDER_ROLE", None)
        if isinstance(placeholder_role, int) and bool(index.data(placeholder_role)):
            return False

        decoration = index.data(Qt.ItemDataRole.DecorationRole)
        if not isinstance(decoration, QPixmap):
            return False

        try:
            dpr = float(decoration.devicePixelRatio())
        except TypeError, RuntimeError:
            dpr = 1.0

        strip_width = int(decoration.width() / max(1.0, dpr))
        strip_height = int(decoration.height() / max(1.0, dpr))
        if strip_width <= 0 or strip_height <= 0:
            return False

        rect = option.rect
        strip_x = rect.x() + (rect.width() - strip_width) // 2
        strip_y = rect.y() + (rect.height() - strip_height) // 2

        # 命中测试：把点击定位到第几个图标。
        x = int(mouse_event.pos().x())
        y = int(mouse_event.pos().y())
        if (
            x < strip_x
            or x >= strip_x + strip_width
            or y < strip_y
            or y >= strip_y + strip_height
        ):
            return False

        icon_index = self.hit_test_icon_index(strip_x, strip_width, x)
        if icon_index < 0:
            return False

        source_row = self.get_source_row(index)
        if source_row < 0:
            return False

        self.on_icon_clicked(source_row, icon_index)
        return True

    def get_source_row(self, index) -> int:  # noqa: ANN001
        model = index.model()
        if isinstance(model, QSortFilterProxyModel):
            index = model.mapToSource(index)
        if not index.isValid():
            return -1
        return int(index.row())

    def hit_test_icon_index(self, strip_x: int, strip_width: int, x: int) -> int:
        count = self.icon_count
        if count <= 0:
            return -1
        if count == 1:
            return 0

        icon_size = int(self.icon_size)
        if icon_size <= 0:
            return -1

        # 计算每个图标的左边界：使用 strip_width 反推 step（含间距）。
        # step = icon_size + spacing
        step = (strip_width - icon_size) / (count - 1)
        rel_x = x - strip_x
        for i in range(count):
            left = int(round(i * step))
            if left <= rel_x < left + icon_size:
                return i
        return -1


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
        except AttributeError, TypeError, RuntimeError:
            # 在部分 Qt 对象/生命周期阶段可能取不到 DPR，回退到 1.0。
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
        except AttributeError, TypeError, RuntimeError:
            # 设置 DPR 失败不影响绘制结果，可忽略。
            pass
        return pixmap

    def build_single_icon_pixmap(
        self, icon: BaseIcon, enabled: bool, is_dark: bool, dpr: float
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
