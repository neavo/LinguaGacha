from typing import Any

from typing import cast

from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QSizePolicy
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import isDarkTheme


class QualityRuleEditPanelBase(QWidget):
    """质量规则编辑面板抽象基类。"""

    BTN_SIZE: int = 28
    FONT_SIZE: int = 12
    ICON_SIZE: int = 16
    TEXT_MIN_HEIGHT: int = 84

    DIVIDER_HEIGHT: int = 1
    VERTICAL_DIVIDER_WIDTH: int = 1
    VERTICAL_DIVIDER_HEIGHT: int = 16
    DIVIDER_DARK_COLOR: str = "rgba(255, 255, 255, 0.08)"
    DIVIDER_LIGHT_COLOR: str = "rgba(0, 0, 0, 0.08)"

    add_requested = Signal()
    save_requested = Signal()
    delete_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.dividers: list[QWidget] = []

    def bind_entry(self, entry: dict[str, Any], index: int) -> None:
        raise NotImplementedError

    def clear(self) -> None:
        raise NotImplementedError

    def set_readonly(self, readonly: bool) -> None:
        raise NotImplementedError

    def has_unsaved_changes(self) -> bool:
        raise NotImplementedError

    def get_current_entry(self) -> dict[str, Any]:
        raise NotImplementedError

    def set_src_error(self, has_error: bool) -> None:
        raise NotImplementedError

    def update_all_divider_styles(self) -> None:
        for line in list(self.dividers):
            if line is None:
                continue
            self.update_divider_style(line)

    def build_divider(self, parent: QWidget) -> QWidget:
        line = QWidget(parent)
        line.setFixedHeight(self.DIVIDER_HEIGHT)
        self.update_divider_style(line)
        self.dividers.append(line)
        return line

    def build_vertical_divider(self, parent: QWidget) -> QWidget:
        line = QWidget(parent)
        line.setFixedWidth(self.VERTICAL_DIVIDER_WIDTH)
        line.setFixedHeight(self.VERTICAL_DIVIDER_HEIGHT)
        self.update_divider_style(line)
        self.dividers.append(line)
        return line

    def update_divider_style(self, line: QWidget) -> None:
        color = self.DIVIDER_DARK_COLOR if isDarkTheme() else self.DIVIDER_LIGHT_COLOR
        line.setStyleSheet(f"QWidget {{ background-color: {color}; }}")

    def apply_button_style(self, button: TransparentPushButton) -> None:
        font = QFont(button.font())
        font.setPixelSize(self.FONT_SIZE)
        button.setFont(font)
        button.setIconSize(QSize(self.ICON_SIZE, self.ICON_SIZE))
        button.setMinimumHeight(self.BTN_SIZE)

    def build_index_card(self, parent: QWidget) -> tuple[CardWidget, CaptionLabel]:
        card = CardWidget(parent)
        card.setBorderRadius(4)
        layout = QHBoxLayout(card)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(8)

        label = CaptionLabel("", card)
        label.setAlignment(
            cast(
                Qt.AlignmentFlag,
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            )
        )
        label.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Preferred)
        label.setMinimumWidth(40)
        font = QFont(label.font())
        font.setPixelSize(self.FONT_SIZE)
        font.setBold(True)
        label.setFont(font)
        label.setTextColor(QColor(214, 143, 0), QColor(255, 183, 77))
        layout.addWidget(label)
        layout.addStretch(1)
        return card, label

    def apply_caption_label_style(self, label: CaptionLabel) -> None:
        label.setTextColor(QColor(128, 128, 128), QColor(128, 128, 128))
        font = QFont(label.font())
        font.setPixelSize(self.FONT_SIZE)
        label.setFont(font)

    def apply_text_edit_style(self, text_edit: QWidget) -> None:
        font = QFont(text_edit.font())
        font.setPixelSize(self.FONT_SIZE)
        text_edit.setFont(font)
        text_edit.setMinimumHeight(self.TEXT_MIN_HEIGHT)
        text_edit.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        text_edit.setProperty("compact", True)
