from typing import Any
from typing import cast

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QSizePolicy
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import FluentIcon
from qfluentwidgets import PillPushButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig

from module.Localizer.Localizer import Localizer
from widget.CustomTextEdit import CustomTextEdit


class GlossaryEditPanel(QWidget):
    """术语表编辑面板，与校对页风格统一"""

    # 布局常量
    BTN_SIZE = 28
    FONT_SIZE = 12
    ICON_SIZE = 16
    TEXT_MIN_HEIGHT = 84

    add_requested = pyqtSignal()
    save_requested = pyqtSignal()
    delete_requested = pyqtSignal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.current_index: int = -1
        self.saved_entry: dict[str, Any] | None = None
        self.dividers: list[QWidget] = []
        self.init_ui()

    def init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.content_widget = QWidget(self)
        content_layout = QVBoxLayout(self.content_widget)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(8)

        # 标题区：序号卡片（术语表没有文件路径，序号在左边）
        self.index_card = CardWidget(self.content_widget)
        self.index_card.setBorderRadius(4)
        index_layout = QHBoxLayout(self.index_card)
        index_layout.setContentsMargins(12, 8, 12, 8)
        index_layout.setSpacing(8)

        self.row_index_label = CaptionLabel("", self.index_card)
        self.row_index_label.setAlignment(
            cast(
                Qt.AlignmentFlag,
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            )
        )
        self.row_index_label.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Preferred)
        self.row_index_label.setMinimumWidth(40)
        idx_font = QFont(self.row_index_label.font())
        idx_font.setPixelSize(self.FONT_SIZE)
        idx_font.setBold(True)
        self.row_index_label.setFont(idx_font)
        # 序号颜色与校对页保持一致
        self.row_index_label.setTextColor(QColor(214, 143, 0), QColor(255, 183, 77))
        index_layout.addWidget(self.row_index_label)
        index_layout.addStretch(1)
        content_layout.addWidget(self.index_card)

        # 编辑区卡片：内容区 + 状态区 + 按钮区
        self.editor_card = CardWidget(self.content_widget)
        self.editor_card.setBorderRadius(4)
        editor_layout = QVBoxLayout(self.editor_card)
        editor_layout.setContentsMargins(12, 10, 12, 10)
        editor_layout.setSpacing(6)

        # 内容区：三个 CustomTextEdit，高度等分，每个上面有标题标签
        # 原文
        self.src_label = CaptionLabel(
            Localizer.get().glossary_page_table_row_01, self.editor_card
        )
        self.src_label.setTextColor(QColor(128, 128, 128), QColor(128, 128, 128))
        label_font = QFont(self.src_label.font())
        label_font.setPixelSize(self.FONT_SIZE)
        self.src_label.setFont(label_font)
        editor_layout.addWidget(self.src_label)

        self.src_text = CustomTextEdit(self.editor_card)
        src_font = QFont(self.src_text.font())
        src_font.setPixelSize(self.FONT_SIZE)
        self.src_text.setFont(src_font)
        self.src_text.setMinimumHeight(self.TEXT_MIN_HEIGHT)
        self.src_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.src_text.setProperty("compact", True)
        self.src_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.src_text, 1)

        # 译文
        self.dst_label = CaptionLabel(
            Localizer.get().glossary_page_table_row_02, self.editor_card
        )
        self.dst_label.setTextColor(QColor(128, 128, 128), QColor(128, 128, 128))
        self.dst_label.setFont(label_font)
        editor_layout.addWidget(self.dst_label)

        self.dst_text = CustomTextEdit(self.editor_card)
        dst_font = QFont(self.dst_text.font())
        dst_font.setPixelSize(self.FONT_SIZE)
        self.dst_text.setFont(dst_font)
        self.dst_text.setMinimumHeight(self.TEXT_MIN_HEIGHT)
        self.dst_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.dst_text.setProperty("compact", True)
        self.dst_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.dst_text, 1)

        # 描述
        self.info_label = CaptionLabel(
            Localizer.get().glossary_page_table_row_04, self.editor_card
        )
        self.info_label.setTextColor(QColor(128, 128, 128), QColor(128, 128, 128))
        self.info_label.setFont(label_font)
        editor_layout.addWidget(self.info_label)

        self.info_text = CustomTextEdit(self.editor_card)
        info_font = QFont(self.info_text.font())
        info_font.setPixelSize(self.FONT_SIZE)
        self.info_text.setFont(info_font)
        self.info_text.setMinimumHeight(self.TEXT_MIN_HEIGHT)
        self.info_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.info_text.setProperty("compact", True)
        self.info_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.info_text, 1)

        # 状态区：带图标文字的 PillPushButton，上下间距对称
        editor_layout.addSpacing(6)
        status_layout = QHBoxLayout()
        status_layout.setContentsMargins(0, 0, 0, 0)
        status_layout.setSpacing(8)

        self.case_button = PillPushButton(
            Localizer.get().rule_case_sensitive, self.editor_card
        )
        self.case_button.setIcon(FluentIcon.FONT)
        self.case_button.setCheckable(True)
        self.case_button.setIconSize(QSize(self.ICON_SIZE, self.ICON_SIZE))
        btn_font = QFont(self.case_button.font())
        btn_font.setPixelSize(self.FONT_SIZE)
        self.case_button.setFont(btn_font)
        self.case_button.clicked.connect(self.on_case_toggled)
        self.case_button.installEventFilter(
            ToolTipFilter(self.case_button, 300, ToolTipPosition.TOP)
        )
        self.update_case_tooltip()
        status_layout.addWidget(self.case_button)
        status_layout.addStretch(1)
        editor_layout.addLayout(status_layout)
        editor_layout.addSpacing(6)

        # 按钮区
        editor_layout.addWidget(self.build_divider(self.editor_card))
        self.button_container = QWidget(self.editor_card)
        button_layout = QHBoxLayout(self.button_container)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(0)

        self.btn_add = TransparentPushButton(self.button_container)
        self.btn_add.setIcon(FluentIcon.ADD)
        self.btn_add.setText(Localizer.get().add)
        self.btn_add.clicked.connect(lambda: self.add_requested.emit())
        self.apply_fixed_button_style(self.btn_add)
        button_layout.addWidget(self.btn_add, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_delete = TransparentPushButton(self.button_container)
        self.btn_delete.setIcon(FluentIcon.DELETE)
        self.btn_delete.setText(Localizer.get().delete)
        self.btn_delete.clicked.connect(lambda: self.delete_requested.emit())
        self.apply_fixed_button_style(self.btn_delete)
        button_layout.addWidget(self.btn_delete, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_save = TransparentPushButton(self.button_container)
        self.btn_save.setIcon(FluentIcon.SAVE)
        self.btn_save.setText(Localizer.get().quality_save)
        self.btn_save.clicked.connect(lambda: self.save_requested.emit())
        self.apply_fixed_button_style(self.btn_save)
        button_layout.addWidget(self.btn_save, 1)

        editor_layout.addWidget(self.button_container)

        content_layout.addWidget(self.editor_card, 1)

        layout.addWidget(self.content_widget, 1)

        self.clear()

        qconfig.themeChanged.connect(self.on_theme_changed)
        self.destroyed.connect(self.disconnect_theme_signals)

    def disconnect_theme_signals(self) -> None:
        try:
            qconfig.themeChanged.disconnect(self.on_theme_changed)
        except (TypeError, RuntimeError):
            pass

    def on_theme_changed(self) -> None:
        self.update_all_divider_styles()

    def update_all_divider_styles(self) -> None:
        for line in list(self.dividers):
            if line is None:
                continue
            self.update_divider_style(line)

    def apply_fixed_button_style(self, button: TransparentPushButton) -> None:
        font = QFont(button.font())
        font.setPixelSize(self.FONT_SIZE)
        button.setFont(font)
        button.setIconSize(QSize(self.ICON_SIZE, self.ICON_SIZE))
        button.setMinimumHeight(self.BTN_SIZE)

    def build_divider(self, parent: QWidget) -> QWidget:
        line = QWidget(parent)
        line.setFixedHeight(1)
        self.update_divider_style(line)
        self.dividers.append(line)
        return line

    def build_vertical_divider(self, parent: QWidget) -> QWidget:
        line = QWidget(parent)
        line.setFixedWidth(1)
        line.setFixedHeight(16)
        self.update_divider_style(line)
        self.dividers.append(line)
        return line

    def update_divider_style(self, line: QWidget) -> None:
        color = "rgba(255, 255, 255, 0.08)" if isDarkTheme() else "rgba(0, 0, 0, 0.08)"
        line.setStyleSheet(f"QWidget {{ background-color: {color}; }}")

    def on_case_toggled(self) -> None:
        self.update_case_tooltip()
        self.update_button_states()

    def update_case_tooltip(self) -> None:
        tooltip = (
            f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_on}"
            if self.case_button.isChecked()
            else f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_off}"
        )
        self.case_button.setToolTip(tooltip)

    def bind_entry(self, entry: dict[str, Any], index: int) -> None:
        self.current_index = index
        self.saved_entry = {
            "src": str(entry.get("src", "")),
            "dst": str(entry.get("dst", "")),
            "info": str(entry.get("info", "")),
            "case_sensitive": bool(entry.get("case_sensitive", False)),
        }

        self.row_index_label.setText(f"#{index}")

        self.src_text.blockSignals(True)
        self.dst_text.blockSignals(True)
        self.info_text.blockSignals(True)

        self.src_text.setPlainText(self.saved_entry["src"])
        self.dst_text.setPlainText(self.saved_entry["dst"])
        self.info_text.setPlainText(self.saved_entry["info"])
        self.case_button.setChecked(self.saved_entry["case_sensitive"])

        self.src_text.blockSignals(False)
        self.dst_text.blockSignals(False)
        self.info_text.blockSignals(False)

        self.src_text.set_error(False)
        self.update_case_tooltip()
        self.update_button_states()

    def clear(self) -> None:
        self.current_index = -1
        self.saved_entry = None
        self.row_index_label.setText("")
        self.src_text.setPlainText("")
        self.dst_text.setPlainText("")
        self.info_text.setPlainText("")
        self.case_button.setChecked(False)
        self.src_text.set_error(False)
        self.update_case_tooltip()
        self.update_button_states()

    def set_readonly(self, readonly: bool) -> None:
        self.src_text.setReadOnly(readonly)
        self.dst_text.setReadOnly(readonly)
        self.info_text.setReadOnly(readonly)
        self.case_button.setEnabled(not readonly)
        self.update_button_states()

    def has_unsaved_changes(self) -> bool:
        if self.saved_entry is None:
            return False
        return self.get_current_entry() != self.saved_entry

    def get_current_entry(self) -> dict[str, Any]:
        return {
            "src": self.src_text.toPlainText().strip(),
            "dst": self.dst_text.toPlainText().strip(),
            "info": self.info_text.toPlainText().strip(),
            "case_sensitive": self.case_button.isChecked(),
        }

    def update_button_states(self) -> None:
        has_entry = self.saved_entry is not None
        has_changes = self.has_unsaved_changes()
        is_readonly = self.src_text.isReadOnly()
        self.btn_add.setEnabled(not is_readonly)
        self.btn_save.setEnabled(has_entry and has_changes and not is_readonly)
        self.btn_delete.setEnabled(has_entry and not is_readonly)

    def set_src_error(self, has_error: bool) -> None:
        self.src_text.set_error(has_error)
