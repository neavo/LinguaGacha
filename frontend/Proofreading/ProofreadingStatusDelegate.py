from __future__ import annotations

from typing import Any
from typing import cast

from PySide6.QtCore import QEvent
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QObject
from PySide6.QtCore import QPoint
from PySide6.QtCore import QRect
from PySide6.QtCore import QTimer
from PySide6.QtCore import Qt
from PySide6.QtGui import QHelpEvent
from PySide6.QtGui import QMouseEvent
from PySide6.QtGui import QPainter
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QScrollBar
from PySide6.QtWidgets import QTableView
from PySide6.QtWidgets import QStyleOptionViewItem
from PySide6.QtWidgets import QWidget
from qfluentwidgets import TableItemDelegate
from qfluentwidgets import ToolTip
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import isDarkTheme

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Proofreading.ProofreadingLabels import ProofreadingLabels
from frontend.Proofreading.ProofreadingTableModel import ProofreadingTableModel
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType


class ProofreadingStatusDelegate(TableItemDelegate):
    """仅负责绘制 STATUS 列的状态/告警图标，以及图标级 tooltip 交互。"""

    ICON_SIZE: int = 16
    ICON_SPACING: int = 4
    TOOLTIP_DELAY_MS: int = 300

    ICON_WARNING: BaseIcon = BaseIcon.TRIANGLE_ALERT
    STATUS_ICONS: dict[Base.ProjectStatus, BaseIcon] = {
        Base.ProjectStatus.PROCESSED: BaseIcon.CIRCLE_CHECK,
        Base.ProjectStatus.PROCESSED_IN_PAST: BaseIcon.HISTORY,
        Base.ProjectStatus.ERROR: BaseIcon.CIRCLE_ALERT,
        Base.ProjectStatus.LANGUAGE_SKIPPED: BaseIcon.CIRCLE_MINUS,
    }

    def __init__(self, parent: QTableView, status_column_index: int) -> None:
        super().__init__(parent)
        self.status_column_index = int(status_column_index)

        # qfluentwidgets 的 TableItemDelegate 在类型标注上更偏向 QObject；这里保留强类型引用。
        self.table = parent

        self.pixmap_cache: dict[tuple[bool, int, str], QPixmap] = {}

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

    # ========== 绘制 ==========
    def paint(
        self, painter: QPainter, option: QStyleOptionViewItem, index: QModelIndex
    ) -> None:
        if index.column() != self.status_column_index:
            super().paint(painter, option, index)
            return

        # 先让 TableItemDelegate 绘制背景/hover/pressed/selected 等样式。
        super().paint(painter, option, index)

        status = index.data(ProofreadingTableModel.STATUS_ROLE)
        warnings = index.data(ProofreadingTableModel.WARNINGS_ROLE)

        has_warning = bool(isinstance(warnings, tuple) and warnings)
        icon_status = (
            self.STATUS_ICONS.get(status)
            if isinstance(status, Base.ProjectStatus)
            else None
        )
        if icon_status is None and not has_warning:
            return

        status_pixmap = (
            self.get_icon_pixmap(icon_status) if icon_status is not None else None
        )
        warning_pixmap = (
            self.get_icon_pixmap(self.ICON_WARNING) if has_warning else None
        )

        status_rect, warning_rect = self.get_icon_rects(
            option.rect, status_pixmap, warning_pixmap
        )

        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setClipping(True)
        painter.setClipRect(option.rect)

        if status_pixmap is not None and status_rect is not None:
            painter.drawPixmap(status_rect.topLeft(), status_pixmap)
        if warning_pixmap is not None and warning_rect is not None:
            painter.drawPixmap(warning_rect.topLeft(), warning_pixmap)

        painter.restore()

    def get_icon_pixmap(self, icon: BaseIcon) -> QPixmap:
        table = self.table
        is_dark = isDarkTheme()

        try:
            dpr = float(table.devicePixelRatioF())
        except AttributeError, TypeError, RuntimeError:
            dpr = 1.0

        key = (is_dark, int(round(dpr * 100)), icon.name)
        cached = self.pixmap_cache.get(key)
        if cached is not None:
            return cached

        # Qt6 下 QIcon.pixmap() 会返回带 DPR 的 pixmap；这里传逻辑尺寸即可。
        # 若手动 setDevicePixelRatio()，在部分平台会把 DPR 覆盖成错误值，导致图标被放大。
        pixmap = icon.icon().pixmap(self.ICON_SIZE, self.ICON_SIZE)

        self.pixmap_cache[key] = pixmap
        return pixmap

    def get_icon_rects(
        self,
        option_rect: QRect,
        status_pixmap: QPixmap | None,
        warning_pixmap: QPixmap | None,
    ) -> tuple[QRect | None, QRect | None]:
        rect = option_rect.adjusted(0, self.margin, 0, -self.margin)

        has_status = status_pixmap is not None
        has_warning = warning_pixmap is not None
        icon_count = int(has_status) + int(has_warning)
        if icon_count <= 0:
            return None, None

        total_width = self.ICON_SIZE * icon_count + self.ICON_SPACING * (icon_count - 1)
        x = rect.x() + (rect.width() - total_width) // 2
        y = rect.y() + (rect.height() - self.ICON_SIZE) // 2

        status_rect = None
        warning_rect = None

        if has_status:
            status_rect = QRect(x, y, self.ICON_SIZE, self.ICON_SIZE)
            x += self.ICON_SIZE + (self.ICON_SPACING if has_warning else 0)
        if has_warning:
            warning_rect = QRect(x, y, self.ICON_SIZE, self.ICON_SIZE)

        return status_rect, warning_rect

    # ========== Tooltip 交互 ==========
    def helpEvent(
        self,
        event: QHelpEvent,
        view: QAbstractItemView,
        option: QStyleOptionViewItem,
        index: QModelIndex,
    ) -> bool:
        if index.column() != self.status_column_index:
            return super().helpEvent(event, view, option, index)

        if event is None or view is None:
            return False

        if event.type() != QEvent.Type.ToolTip:
            return False

        viewport = cast(QWidget, view.viewport())
        pos = viewport.mapFromGlobal(event.globalPos())
        text = self.hit_test_tooltip_text(pos, option, index)
        if not text:
            self.hide_tooltip()
            return False

        self.tooltip_pending_text = text
        self.tooltip_timer.stop()
        self.tooltip_timer.start(self.TOOLTIP_DELAY_MS)
        return True

    def hit_test_tooltip_text(
        self,
        pos: QPoint,
        option: QStyleOptionViewItem,
        index: QModelIndex,
    ) -> str:
        status = index.data(ProofreadingTableModel.STATUS_ROLE)
        warnings = index.data(ProofreadingTableModel.WARNINGS_ROLE)

        warnings_tuple: tuple[WarningType, ...] = (
            warnings if isinstance(warnings, tuple) else tuple()
        )

        icon_status = (
            self.STATUS_ICONS.get(status)
            if isinstance(status, Base.ProjectStatus)
            else None
        )
        status_pixmap = (
            self.get_icon_pixmap(icon_status) if icon_status is not None else None
        )
        warning_pixmap = (
            self.get_icon_pixmap(self.ICON_WARNING) if warnings_tuple else None
        )

        status_rect, warning_rect = self.get_icon_rects(
            option.rect, status_pixmap, warning_pixmap
        )
        if status_rect is not None and status_rect.contains(pos):
            self.set_tooltip_anchor_rect(status_rect)
            return self.build_status_tooltip(status)
        if warning_rect is not None and warning_rect.contains(pos):
            self.set_tooltip_anchor_rect(warning_rect)
            return self.build_warning_tooltip(warnings_tuple)
        return ""

    def set_tooltip_anchor_rect(self, rect: QRect) -> None:
        # tooltip 需要用一个虚拟 widget 来复刻 ToolTipPosition.TOP 的居中计算。
        self.tooltip_anchor.setGeometry(rect)

    def build_status_tooltip(self, status: Any) -> str:
        if not isinstance(status, Base.ProjectStatus):
            return ""
        if status not in self.STATUS_ICONS:
            return ""
        return (
            f"{Localizer.get().proofreading_page_filter_status}\n"
            f"{Localizer.get().status}{ProofreadingLabels.get_status_label(status)}"
        )

    def build_warning_tooltip(self, warnings: tuple[WarningType, ...]) -> str:
        if not warnings:
            return ""
        warning_texts = [ProofreadingLabels.get_warning_label(e) for e in warnings]
        return (
            f"{Localizer.get().proofreading_page_result_check}\n"
            f"{Localizer.get().status}{' | '.join(warning_texts)}"
        )

    def show_tooltip(self) -> None:
        if not self.tooltip_pending_text:
            return

        table = self.table

        duration = table.toolTipDuration() if table.toolTipDuration() > 0 else -1
        self.tooltip.setDuration(duration)
        self.tooltip.setText(self.tooltip_pending_text)
        self.tooltip.adjustPos(self.tooltip_anchor, ToolTipPosition.TOP)
        self.tooltip.show()

    def hide_tooltip(self) -> None:
        self.tooltip_pending_text = ""
        self.tooltip_timer.stop()
        self.tooltip.hide()

    def eventFilter(self, object: QObject | None, event: QEvent | None) -> bool:
        table = self.table

        if object is None or event is None:
            return False

        if object is table:
            if event.type() in (QEvent.Type.Hide, QEvent.Type.Leave):
                self.hide_tooltip()
        elif object is table.viewport():
            if event.type() == QEvent.Type.MouseButtonPress:
                self.hide_tooltip()
            elif event.type() == QEvent.Type.MouseMove and (
                self.tooltip.isVisible() or self.tooltip_timer.isActive()
            ):
                mouse_event = cast(QMouseEvent, event)
                pos = mouse_event.pos()
                index = table.indexAt(pos)
                if not index.isValid() or index.column() != self.status_column_index:
                    self.hide_tooltip()
                else:
                    option = QStyleOptionViewItem()
                    option.rect = table.visualRect(index)
                    text = self.hit_test_tooltip_text(pos, option, index)
                    if not text:
                        self.hide_tooltip()
                    elif text != self.tooltip_pending_text:
                        # 在 tooltip 显示或延迟期间切换到另一枚图标：隐藏并重新计时。
                        self.hide_tooltip()
                        self.tooltip_pending_text = text
                        self.tooltip_timer.start(self.TOOLTIP_DELAY_MS)

        return False
