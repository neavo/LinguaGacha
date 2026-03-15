from __future__ import annotations

import dataclasses
from typing import Callable
from typing import cast

from PySide6.QtCore import QEvent
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QObject
from PySide6.QtCore import QPoint
from PySide6.QtCore import QRect
from PySide6.QtCore import QTimer
from PySide6.QtCore import Qt
from PySide6.QtCore import QSortFilterProxyModel
from PySide6.QtGui import QHelpEvent
from PySide6.QtGui import QColor
from PySide6.QtGui import QMouseEvent
from PySide6.QtGui import QPainter
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QScrollBar
from PySide6.QtWidgets import QStyleOptionViewItem
from PySide6.QtWidgets import QTableView
from PySide6.QtWidgets import QWidget
from qfluentwidgets import TableItemDelegate
from qfluentwidgets import ToolTip
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import isDarkTheme
from qfluentwidgets import themeColor

from base.BaseIcon import BaseIcon


@dataclasses.dataclass(frozen=True)
class RuleIconSpec:
    icon: BaseIcon
    enabled: bool


@dataclasses.dataclass(frozen=True)
class IconColumnConfig:
    """图标列配置。

    统一描述“哪一列展示图标、图标个数、是否可点击”，避免页面侧散落魔术参数。
    """

    column_index: int
    icon_count: int = 1
    on_icon_clicked: Callable[[int, int], None] | None = None
    icon_tooltip_getter: Callable[[int, int], str] | None = None


class QualityRuleIconDelegate(TableItemDelegate):
    """保持表格交互样式的同时绘制规则图标。"""

    TOOLTIP_DELAY_MS: int = 300

    def __init__(
        self,
        parent: QTableView,
        icon_column_index: int,
        icon_size: int,
        *,
        icon_count: int = 1,
        on_icon_clicked: Callable[[int, int], None] | None = None,
        icon_column_configs: list[IconColumnConfig] | None = None,
    ) -> None:
        super().__init__(parent)
        self.icon_size = int(icon_size)
        self.icon_column_configs: dict[int, IconColumnConfig] = {}
        if icon_column_configs:
            for config in icon_column_configs:
                normalized = IconColumnConfig(
                    column_index=int(config.column_index),
                    icon_count=max(0, int(config.icon_count)),
                    on_icon_clicked=config.on_icon_clicked,
                    icon_tooltip_getter=config.icon_tooltip_getter,
                )
                self.icon_column_configs[normalized.column_index] = normalized
        else:
            normalized = IconColumnConfig(
                column_index=int(icon_column_index),
                icon_count=max(0, int(icon_count)),
                on_icon_clicked=on_icon_clicked,
            )
            self.icon_column_configs[normalized.column_index] = normalized
        self.tooltipDelegate.setToolTipDelay(self.TOOLTIP_DELAY_MS)

        self.table = cast(QTableView, parent)
        self.tooltip = ToolTip("", parent.window())
        self.tooltip.hide()

        self.tooltip_timer = QTimer(self)
        self.tooltip_timer.setSingleShot(True)
        self.tooltip_timer.timeout.connect(self.show_tooltip)
        self.tooltip_pending_text: str = ""

        viewport = cast(QWidget, parent.viewport())
        self.tooltip_anchor = QWidget(viewport)
        self.tooltip_anchor.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents
        )
        self.tooltip_anchor.hide()

        parent.installEventFilter(self)
        viewport.installEventFilter(self)

        h_scroll = cast(QScrollBar, parent.horizontalScrollBar())
        v_scroll = cast(QScrollBar, parent.verticalScrollBar())
        h_scroll.valueChanged.connect(self.hide_tooltip)
        v_scroll.valueChanged.connect(self.hide_tooltip)

    def get_icon_column_config(self, column_index: int) -> IconColumnConfig | None:
        return self.icon_column_configs.get(int(column_index))

    def paint(self, painter, option, index) -> None:
        config = self.get_icon_column_config(index.column())
        if config is None:
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
        event: QEvent | None,
        model,  # noqa: ANN001
        option,
        index,
    ) -> bool:
        if event is None:
            return False
        config = self.get_icon_column_config(index.column())
        if config is None:
            return super().editorEvent(event, model, option, index)
        if not callable(config.on_icon_clicked):
            return super().editorEvent(event, model, option, index)

        if event.type() != QEvent.Type.MouseButtonRelease:
            return False

        mouse_event = event
        if not isinstance(mouse_event, QMouseEvent):
            return False
        if mouse_event.button() != Qt.MouseButton.LeftButton:
            return False

        if self.is_placeholder_index(model, index):
            return False

        decoration = index.data(Qt.ItemDataRole.DecorationRole)
        if not isinstance(decoration, QPixmap):
            return False

        strip_rect = self.get_icon_strip_rect(option.rect, decoration)
        if strip_rect.width() <= 0 or strip_rect.height() <= 0:
            return False

        # 命中测试：把点击定位到第几个图标。
        x = int(mouse_event.pos().x())
        y = int(mouse_event.pos().y())
        if not strip_rect.contains(x, y):
            return False

        icon_index = self.hit_test_icon_index(
            strip_rect.x(),
            strip_rect.width(),
            x,
            config.icon_count,
            self.get_strip_icon_size(strip_rect),
        )
        if icon_index < 0:
            return False

        source_row = self.get_source_row(index)
        if source_row < 0:
            return False

        config.on_icon_clicked(source_row, icon_index)
        return True

    def get_source_row(self, index) -> int:  # noqa: ANN001
        model = index.model()
        if isinstance(model, QSortFilterProxyModel):
            index = model.mapToSource(index)
        if not index.isValid():
            return -1
        return int(index.row())

    def hit_test_icon_index(
        self,
        strip_x: int,
        strip_width: int,
        x: int,
        icon_count: int,
        icon_size: int,
    ) -> int:
        count = max(0, int(icon_count))
        if count <= 0:
            return -1
        if count == 1:
            return 0

        normalized_icon_size = max(1, min(int(icon_size), int(strip_width)))
        if normalized_icon_size <= 0:
            return -1

        # 为什么使用当前 strip 的图标尺寸：
        # 同一个委托可能同时服务 24px 规则列和 16px 统计列，
        # 若固定使用 self.icon_size，会导致小图标列命中区域错位。
        step = (strip_width - normalized_icon_size) / (count - 1)
        rel_x = x - strip_x
        for i in range(count):
            left = int(round(i * step))
            if left <= rel_x < left + normalized_icon_size:
                return i
        return -1

    def helpEvent(
        self,
        event: QHelpEvent | None,
        view: QAbstractItemView,
        option: QStyleOptionViewItem,
        index: QModelIndex,
    ) -> bool:
        config = self.get_icon_column_config(index.column())
        if config is None or not callable(config.icon_tooltip_getter):
            return super().helpEvent(event, view, option, index)

        if event is None or view is None:
            return False
        if event.type() != QEvent.Type.ToolTip:
            return False

        text, icon_rect = self.resolve_icon_tooltip_at_pos(event.pos(), option, index)
        if text == "" or icon_rect is None:
            self.hide_tooltip()
            return False

        self.set_tooltip_anchor_rect(icon_rect)
        self.tooltip_pending_text = text
        self.tooltip_timer.stop()
        self.tooltip_timer.start(self.TOOLTIP_DELAY_MS)
        return True

    def resolve_icon_tooltip_at_pos(
        self,
        pos: QPoint,
        option: QStyleOptionViewItem,
        index: QModelIndex,
    ) -> tuple[str, QRect | None]:
        config = self.get_icon_column_config(index.column())
        if config is None or not callable(config.icon_tooltip_getter):
            return "", None

        model = index.model()
        if self.is_placeholder_index(model, index):
            return "", None

        decoration = index.data(Qt.ItemDataRole.DecorationRole)
        if not isinstance(decoration, QPixmap):
            return "", None

        strip_rect = self.get_icon_strip_rect(option.rect, decoration)
        if not strip_rect.contains(pos):
            return "", None

        icon_index = self.hit_test_icon_index(
            strip_rect.x(),
            strip_rect.width(),
            int(pos.x()),
            config.icon_count,
            self.get_strip_icon_size(strip_rect),
        )
        if icon_index < 0:
            return "", None

        source_row = self.get_source_row(index)
        if source_row < 0:
            return "", None

        text = str(config.icon_tooltip_getter(source_row, icon_index)).strip()
        if text == "":
            return "", None

        icon_rect = self.get_icon_rect(
            strip_rect,
            icon_index,
            config.icon_count,
            self.get_strip_icon_size(strip_rect),
        )
        return text, icon_rect

    def get_icon_rect(
        self,
        strip_rect: QRect,
        icon_index: int,
        icon_count: int,
        icon_size: int,
    ) -> QRect:
        count = max(1, int(icon_count))
        normalized_index = max(0, min(int(icon_index), count - 1))
        normalized_icon_size = max(
            1,
            min(int(icon_size), int(strip_rect.width()), int(strip_rect.height())),
        )
        if count <= 1:
            icon_x = strip_rect.x() + (strip_rect.width() - normalized_icon_size) // 2
        else:
            step = (strip_rect.width() - normalized_icon_size) / (count - 1)
            icon_x = strip_rect.x() + int(round(normalized_index * step))
        icon_y = strip_rect.y() + (strip_rect.height() - normalized_icon_size) // 2
        return QRect(icon_x, icon_y, normalized_icon_size, normalized_icon_size)

    def get_strip_icon_size(self, strip_rect: QRect) -> int:
        # 图标条高度等于当前列图标尺寸，直接从 strip 读取可保证多列尺寸一致命中。
        return max(1, int(strip_rect.height()))

    def set_tooltip_anchor_rect(self, rect: QRect) -> None:
        # ToolTipPosition.TOP 依赖一个 widget 锚点来计算居中位置。
        self.tooltip_anchor.setGeometry(rect)

    def show_tooltip(self) -> None:
        if not self.tooltip_pending_text:
            return

        duration = (
            self.table.toolTipDuration() if self.table.toolTipDuration() > 0 else -1
        )
        self.tooltip.setDuration(duration)
        self.tooltip.setText(self.tooltip_pending_text)
        self.tooltip.adjustPos(self.tooltip_anchor, ToolTipPosition.TOP)
        self.tooltip.show()

    def hide_tooltip(self) -> None:
        self.tooltip_pending_text = ""
        self.tooltip_timer.stop()
        self.tooltip.hide()

    def eventFilter(self, watched: QObject | None, event: QEvent | None) -> bool:
        table = self.table
        if watched is None or event is None:
            return False

        if watched is table:
            if event.type() in (QEvent.Type.Hide, QEvent.Type.Leave):
                self.hide_tooltip()
        elif watched is table.viewport():
            if event.type() == QEvent.Type.MouseButtonPress:
                self.hide_tooltip()
            elif event.type() == QEvent.Type.MouseMove and (
                self.tooltip.isVisible() or self.tooltip_timer.isActive()
            ):
                mouse_event = cast(QMouseEvent, event)
                pos = mouse_event.pos()
                index = table.indexAt(pos)
                if not index.isValid():
                    self.hide_tooltip()
                else:
                    config = self.get_icon_column_config(index.column())
                    if config is None or not callable(config.icon_tooltip_getter):
                        self.hide_tooltip()
                    else:
                        option = QStyleOptionViewItem()
                        option.rect = table.visualRect(index)
                        text, icon_rect = self.resolve_icon_tooltip_at_pos(
                            pos,
                            option,
                            index,
                        )
                        if text == "" or icon_rect is None:
                            self.hide_tooltip()
                        elif (
                            text != self.tooltip_pending_text
                            or self.tooltip_anchor.geometry() != icon_rect
                        ):
                            # 从一个图标移动到另一个图标时，重置计时器并刷新锚点。
                            self.hide_tooltip()
                            self.set_tooltip_anchor_rect(icon_rect)
                            self.tooltip_pending_text = text
                            self.tooltip_timer.start(self.TOOLTIP_DELAY_MS)
        return False

    def is_placeholder_index(self, model, index: QModelIndex) -> bool:  # noqa: ANN001
        placeholder_role = getattr(model, "PLACEHOLDER_ROLE", None)
        if not isinstance(placeholder_role, int) and isinstance(
            model, QSortFilterProxyModel
        ):
            placeholder_role = getattr(model.sourceModel(), "PLACEHOLDER_ROLE", None)
        if not isinstance(placeholder_role, int):
            return False
        return bool(index.data(placeholder_role))

    def get_icon_strip_rect(self, option_rect: QRect, decoration: QPixmap) -> QRect:
        try:
            dpr = float(decoration.devicePixelRatio())
        except TypeError, RuntimeError:
            dpr = 1.0

        strip_width = int(decoration.width() / max(1.0, dpr))
        strip_height = int(decoration.height() / max(1.0, dpr))
        x = option_rect.x() + (option_rect.width() - strip_width) // 2
        y = option_rect.y() + (option_rect.height() - strip_height) // 2
        return QRect(x, y, strip_width, strip_height)


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
