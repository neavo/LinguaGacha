from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from typing import Optional

from PySide6.QtCore import QEvent
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QPoint
from PySide6.QtCore import QRect
from PySide6.QtCore import Qt
from PySide6.QtGui import QMouseEvent
from PySide6.QtGui import QIcon
from PySide6.QtGui import QPainter
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QStyleOptionViewItem
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableItemDelegate
from qfluentwidgets import isDarkTheme

from base.BaseIcon import BaseIcon


@dataclass(frozen=True, slots=True)
class ActionSpec:
    text: str = ""
    icon: BaseIcon | None = None
    triggered: Callable[[], None] | None = None
    enabled: bool = True
    separator: bool = False


class ActionMenuDelegate(TableItemDelegate):
    ICON_SIZE: int = 16
    BUTTON_SIZE: int = 28
    ENTRY_ICON: BaseIcon = BaseIcon.CIRCLE_ELLIPSIS

    def __init__(
        self,
        parent: QAbstractItemView,
        *,
        actions_provider: Callable[[QModelIndex], list[ActionSpec]],
        is_readonly: Callable[[], bool] | None = None,
    ) -> None:
        super().__init__(parent)
        self.view = parent
        self.actions_provider = actions_provider
        self.is_readonly = is_readonly if is_readonly is not None else lambda: False
        self.pixmap_cache: dict[tuple[bool, int, str], QPixmap] = {}

    def paint(
        self, painter: QPainter, option: QStyleOptionViewItem, index: QModelIndex
    ) -> None:
        # TableView 的 hover/pressed/selected 状态维护在 view 的“默认 delegate”上。
        # 若给某一列设置了独立 delegate（setItemDelegateForColumn），该 delegate
        # 自身的状态不会被 TableView 自动更新，导致这一列的悬浮/选中背景不一致。
        # 这里在 paint 前同步状态，确保整行高亮覆盖到操作列。
        self.sync_state_from_view_delegate()
        super().paint(painter, option, index)

        if not index.isValid():
            return

        model = index.model()
        placeholder_role = getattr(model, "PLACEHOLDER_ROLE", None)
        if isinstance(placeholder_role, int) and bool(index.data(placeholder_role)):
            return

        button_rect = self.get_button_rect(option.rect)
        icon_rect = self.get_icon_rect(button_rect)
        pixmap = self.get_icon_pixmap(self.ENTRY_ICON)

        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        if self.is_readonly():
            painter.setOpacity(0.35)
        painter.drawPixmap(icon_rect.topLeft(), pixmap)
        painter.restore()

    def sync_state_from_view_delegate(self) -> None:
        base_delegate = self.view.itemDelegate()
        if base_delegate is None or base_delegate is self:
            return

        hover_row = getattr(base_delegate, "hoverRow", None)
        if isinstance(hover_row, int):
            self.hoverRow = hover_row

        pressed_row = getattr(base_delegate, "pressedRow", None)
        if isinstance(pressed_row, int):
            self.pressedRow = pressed_row

        selected_rows = getattr(base_delegate, "selectedRows", None)
        if isinstance(selected_rows, set):
            self.selectedRows.clear()
            self.selectedRows.update(selected_rows)

    def editorEvent(
        self,
        event: Optional[QEvent],
        model,  # noqa: ANN001
        option: QStyleOptionViewItem,
        index: QModelIndex,
    ) -> bool:
        if event is None:
            return False
        if not index.isValid():
            return False

        placeholder_role = getattr(model, "PLACEHOLDER_ROLE", None)
        if isinstance(placeholder_role, int) and bool(index.data(placeholder_role)):
            return False

        if self.is_readonly():
            return False

        if event.type() != QEvent.Type.MouseButtonRelease:
            return False

        mouse_event = event
        if not isinstance(mouse_event, QMouseEvent):
            return False

        if mouse_event.button() != Qt.MouseButton.LeftButton:
            return False

        if not self.get_button_rect(option.rect).contains(mouse_event.pos()):
            return False

        actions = self.actions_provider(index)
        if not actions:
            return False

        menu = RoundMenu(parent=self.view)
        for spec in actions:
            if spec.separator:
                menu.addSeparator()
                continue

            if not spec.text:
                continue

            icon = spec.icon if spec.icon is not None else QIcon()
            action = Action(
                icon,
                spec.text,
                triggered=(lambda checked, cb=spec.triggered: cb() if cb else None),
            )
            action.setEnabled(bool(spec.enabled))
            menu.addAction(action)

        anchor = self.get_menu_anchor_global_pos(index)
        if anchor is None:
            return False
        menu.exec(anchor)
        return True

    def get_menu_anchor_global_pos(self, index: QModelIndex) -> QPoint | None:
        view = self.view
        viewport = view.viewport()
        if viewport is None:
            return None

        rect = view.visualRect(index)
        if rect.isNull():
            return None

        anchor = QPoint(rect.right() + 8, rect.top())
        return viewport.mapToGlobal(anchor)

    def get_button_rect(self, option_rect: QRect) -> QRect:
        rect = option_rect.adjusted(0, self.margin, 0, -self.margin)
        x = rect.x() + (rect.width() - self.BUTTON_SIZE) // 2
        y = rect.y() + (rect.height() - self.BUTTON_SIZE) // 2
        return QRect(x, y, self.BUTTON_SIZE, self.BUTTON_SIZE)

    def get_icon_rect(self, button_rect: QRect) -> QRect:
        x = button_rect.x() + (button_rect.width() - self.ICON_SIZE) // 2
        y = button_rect.y() + (button_rect.height() - self.ICON_SIZE) // 2
        return QRect(x, y, self.ICON_SIZE, self.ICON_SIZE)

    def get_icon_pixmap(self, icon: BaseIcon) -> QPixmap:
        view = self.view
        is_dark = isDarkTheme()

        try:
            dpr = float(view.devicePixelRatioF())
        except AttributeError:
            dpr = 1.0
        except TypeError, RuntimeError:
            dpr = 1.0

        key = (is_dark, int(round(dpr * 100)), icon.name)
        cached = self.pixmap_cache.get(key)
        if cached is not None:
            return cached

        # Qt6 的 QIcon.pixmap() 会返回带 DPR 的 pixmap；这里传逻辑尺寸即可。
        # 若手动乘 dpr 会导致图标在高 DPI 下被放大一截。
        pixmap = icon.icon().pixmap(self.ICON_SIZE, self.ICON_SIZE)

        self.pixmap_cache[key] = pixmap
        return pixmap
