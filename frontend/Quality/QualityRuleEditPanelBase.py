from typing import Any
from typing import Callable
from typing import cast

from PySide6.QtCore import QPoint
from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtGui import QFont
from qfluentwidgets import Action
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QSizePolicy
from PySide6.QtWidgets import QWidget
from qfluentwidgets import RoundMenu
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer


ICON_ADD_ENTRY: BaseIcon = BaseIcon.PLUS  # 按钮：新增条目
ICON_SAVE_ENTRY: BaseIcon = BaseIcon.SAVE  # 按钮：保存修改
ICON_MORE_ACTIONS: BaseIcon = BaseIcon.ELLIPSIS  # 按钮：更多操作
ICON_DELETE_ENTRY: BaseIcon = BaseIcon.TRASH_2  # 菜单：删除条目
ICON_QUERY_ENTRY: BaseIcon = BaseIcon.SEARCH  # 菜单：查询条目


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
    query_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.dividers: list[QWidget] = []
        self.btn_add: TransparentPushButton | None = None
        self.btn_save: TransparentPushButton | None = None
        self.btn_more: TransparentPushButton | None = None
        self.delete_action_enabled: bool = False

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

    def can_query_current_entry(self) -> bool:
        """只有当前编辑内容存在可搜索的 src 时才开放查询入口。"""

        entry = self.get_current_entry()
        return bool(str(entry.get("src", "")).strip())

    def disconnect_theme_changed_signal(self, callback: Callable[[], None]) -> None:
        """统一断开主题信号，避免各面板重复写相同的异常兜底。"""

        try:
            qconfig.themeChanged.disconnect(callback)
        except TypeError, RuntimeError:
            # Qt 对象销毁或重复断开连接时可能抛异常，可忽略。
            pass

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

    def build_action_button_bar(self, parent: QWidget) -> QWidget:
        """构建统一的底部操作栏，避免三个规则页的按钮语义继续漂移。"""

        self.button_container = QWidget(parent)
        button_layout = QHBoxLayout(self.button_container)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(0)

        self.btn_add = TransparentPushButton(self.button_container)
        self.btn_add.setIcon(ICON_ADD_ENTRY)
        self.btn_add.setText(Localizer.get().add)
        self.btn_add.clicked.connect(lambda: self.add_requested.emit())
        self.apply_button_style(self.btn_add)
        button_layout.addWidget(self.btn_add, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_save = TransparentPushButton(self.button_container)
        self.btn_save.setIcon(ICON_SAVE_ENTRY)
        self.btn_save.setText(Localizer.get().save)
        self.btn_save.clicked.connect(lambda: self.save_requested.emit())
        self.apply_button_style(self.btn_save)
        button_layout.addWidget(self.btn_save, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_more = TransparentPushButton(self.button_container)
        self.btn_more.setIcon(ICON_MORE_ACTIONS)
        self.btn_more.setText(Localizer.get().proofreading_page_more)
        self.btn_more.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.btn_more.clicked.connect(self.show_more_menu)
        self.apply_button_style(self.btn_more)
        button_layout.addWidget(self.btn_more, 1)

        return self.button_container

    def trigger_save_button_if_enabled(self) -> None:
        """统一处理 Ctrl+S，避免每个子类都重复点一次按钮。"""

        if self.btn_save is None:
            return
        if self.btn_save.isEnabled():
            self.btn_save.click()

    def update_action_button_states(
        self,
        *,
        has_entry: bool,
        has_changes: bool,
        is_readonly: bool,
    ) -> None:
        """同步公共操作按钮状态，保持三个规则页行为一致。"""

        self.delete_action_enabled = has_entry and not is_readonly
        if self.btn_add is not None:
            self.btn_add.setEnabled(not is_readonly)
        if self.btn_save is not None:
            self.btn_save.setEnabled(has_entry and has_changes and not is_readonly)
        if self.btn_more is not None:
            self.btn_more.setEnabled(True)

    def show_more_menu(self) -> None:
        """更多菜单统一承载次级动作，避免主按钮区越来越拥挤。"""

        if self.btn_more is None:
            return

        menu = RoundMenu("", self.btn_more)
        action_delete = Action(
            ICON_DELETE_ENTRY,
            Localizer.get().delete,
            triggered=lambda: self.delete_requested.emit(),
        )
        action_delete.setEnabled(self.delete_action_enabled)
        menu.addAction(action_delete)

        action_query = Action(
            ICON_QUERY_ENTRY,
            Localizer.get().quality_query,
            triggered=lambda: self.query_requested.emit(),
        )
        action_query.setEnabled(self.can_query_current_entry())
        menu.addAction(action_query)

        global_pos: QPoint = self.btn_more.mapToGlobal(
            self.btn_more.rect().bottomLeft()
        )
        menu.exec(global_pos)
