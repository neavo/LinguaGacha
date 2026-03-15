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

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Proofreading.ProofreadingLabels import ProofreadingLabels
from frontend.Proofreading.ProofreadingTableModel import ProofreadingTableModel
from frontend.Utils.StatusColumnIconStrip import StatusColumnIconStrip
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
        Base.ProjectStatus.EXCLUDED: BaseIcon.BAN,
        Base.ProjectStatus.LANGUAGE_SKIPPED: BaseIcon.CIRCLE_MINUS,
    }

    def __init__(self, parent: QTableView, status_column_index: int) -> None:
        super().__init__(parent)
        self.status_column_index = int(status_column_index)

        # qfluentwidgets 的 TableItemDelegate 在类型标注上更偏向 QObject；这里保留强类型引用。
        self.table = parent

        self.pixmap_cache: dict[tuple[bool, int, int, str], QPixmap] = {}

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

    def resolve_status(self, raw: Any) -> Base.ProjectStatus | None:
        """Qt 的 QVariant 可能会把 StrEnum 退化成 str，这里统一归一化。"""

        if isinstance(raw, Base.ProjectStatus):
            return raw
        if isinstance(raw, str):
            try:
                return Base.ProjectStatus(raw)
            except ValueError:
                return None
        return None

    # ========== 绘制 ==========
    def paint(
        self, painter: QPainter, option: QStyleOptionViewItem, index: QModelIndex
    ) -> None:
        if index.column() != self.status_column_index:
            super().paint(painter, option, index)
            return

        # 先让 TableItemDelegate 绘制背景/hover/pressed/selected 等样式。
        super().paint(painter, option, index)

        raw_status = index.data(ProofreadingTableModel.STATUS_ROLE)
        warnings = index.data(ProofreadingTableModel.WARNINGS_ROLE)

        has_warning = bool(isinstance(warnings, tuple) and warnings)
        status = self.resolve_status(raw_status)
        icon_status = self.STATUS_ICONS.get(status) if status is not None else None
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
        return StatusColumnIconStrip.get_icon_pixmap(
            self.table,
            icon,
            icon_size=self.ICON_SIZE,
            cache=self.pixmap_cache,
        )

    def get_icon_rects(
        self,
        option_rect: QRect,
        status_pixmap: QPixmap | None,
        warning_pixmap: QPixmap | None,
    ) -> tuple[QRect | None, QRect | None]:
        has_status = status_pixmap is not None
        has_warning = warning_pixmap is not None
        icon_count = int(has_status) + int(has_warning)
        if icon_count <= 0:
            return None, None

        icon_rects = StatusColumnIconStrip.build_centered_icon_rects(
            option_rect,
            icon_count=icon_count,
            icon_size=self.ICON_SIZE,
            icon_spacing=self.ICON_SPACING,
            margin=self.margin,
        )

        rect_index = 0
        status_rect: QRect | None = None
        warning_rect: QRect | None = None
        if has_status:
            status_rect = icon_rects[rect_index]
            rect_index += 1
        if has_warning:
            warning_rect = icon_rects[rect_index]

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
        raw_status = index.data(ProofreadingTableModel.STATUS_ROLE)
        warnings = index.data(ProofreadingTableModel.WARNINGS_ROLE)

        warnings_tuple = warnings if isinstance(warnings, tuple) else tuple()

        status = self.resolve_status(raw_status)
        icon_status = self.STATUS_ICONS.get(status) if status is not None else None
        status_pixmap = (
            self.get_icon_pixmap(icon_status) if icon_status is not None else None
        )
        warning_pixmap = (
            self.get_icon_pixmap(self.ICON_WARNING) if warnings_tuple else None
        )

        status_rect, warning_rect = self.get_icon_rects(
            option.rect, status_pixmap, warning_pixmap
        )

        icon_rects: tuple[QRect, ...] = tuple(
            rect for rect in (status_rect, warning_rect) if rect is not None
        )
        hit_index = StatusColumnIconStrip.hit_test_icon_rects(pos, icon_rects)
        if hit_index < 0:
            return ""

        has_status = status_rect is not None
        has_warning = warning_rect is not None
        if has_status and hit_index == 0:
            self.set_tooltip_anchor_rect(icon_rects[hit_index])
            return self.build_status_tooltip(status)
        if has_warning and (
            (has_status and hit_index == 1) or (not has_status and hit_index == 0)
        ):
            self.set_tooltip_anchor_rect(icon_rects[hit_index])
            return self.build_warning_tooltip(warnings_tuple)
        return ""

    def set_tooltip_anchor_rect(self, rect: QRect) -> None:
        # tooltip 需要用一个虚拟 widget 来复刻 ToolTipPosition.TOP 的居中计算。
        self.tooltip_anchor.setGeometry(rect)

    def build_status_tooltip(self, status: Any) -> str:
        resolved = self.resolve_status(status)
        if resolved is None:
            return ""
        if resolved not in self.STATUS_ICONS:
            return ""
        return (
            f"{Localizer.get().proofreading_page_filter_status}\n"
            f"{Localizer.get().status}{ProofreadingLabels.get_status_label(resolved)}"
        )

    def build_warning_tooltip(self, warnings: tuple[WarningType | str, ...]) -> str:
        if not warnings:
            return ""

        warning_texts: list[str] = []
        for warning_item in warnings:
            if isinstance(warning_item, WarningType):
                warning_texts.append(ProofreadingLabels.get_warning_label(warning_item))
                continue
            if isinstance(warning_item, str):
                try:
                    warning_texts.append(
                        ProofreadingLabels.get_warning_label(WarningType(warning_item))
                    )
                except ValueError:
                    warning_texts.append(warning_item)
                continue
            warning_texts.append(str(warning_item))
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
