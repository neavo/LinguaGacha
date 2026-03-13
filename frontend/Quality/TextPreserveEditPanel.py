from typing import Any

from PySide6.QtGui import QKeySequence
from PySide6.QtGui import QShortcut
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import qconfig

from frontend.Quality.QualityRuleEditPanelBase import QualityRuleEditPanelBase
from module.Localizer.Localizer import Localizer
from widget.CustomTextEdit import CustomTextEdit


class TextPreserveEditPanel(QualityRuleEditPanelBase):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.current_index: int = -1
        self.saved_entry: dict[str, Any] | None = None
        self.init_ui()

    def init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.content_widget = QWidget(self)
        content_layout = QVBoxLayout(self.content_widget)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(8)

        self.index_card, self.row_index_label = self.build_index_card(
            self.content_widget
        )
        content_layout.addWidget(self.index_card)

        self.editor_card = CardWidget(self.content_widget)
        self.editor_card.setBorderRadius(4)
        editor_layout = QVBoxLayout(self.editor_card)
        editor_layout.setContentsMargins(12, 10, 12, 10)
        editor_layout.setSpacing(6)

        self.src_label = CaptionLabel(Localizer.get().table_col_rule, self.editor_card)
        self.apply_caption_label_style(self.src_label)
        editor_layout.addWidget(self.src_label)

        self.src_text = CustomTextEdit(self.editor_card)
        self.apply_text_edit_style(self.src_text)
        self.src_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.src_text, 1)

        self.info_label = CaptionLabel(
            Localizer.get().text_preserve_page_table_row_02, self.editor_card
        )
        self.apply_caption_label_style(self.info_label)
        editor_layout.addWidget(self.info_label)

        self.info_text = CustomTextEdit(self.editor_card)
        self.apply_text_edit_style(self.info_text)
        self.info_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.info_text, 1)

        editor_layout.addSpacing(6)
        editor_layout.addWidget(self.build_divider(self.editor_card))
        self.button_container = self.build_action_button_bar(self.editor_card)
        if self.btn_save is not None:
            self.btn_save.installEventFilter(
                ToolTipFilter(self.btn_save, 300, ToolTipPosition.TOP)
            )
            self.btn_save.setToolTip(Localizer.get().shortcut_ctrl_s)
        editor_layout.addWidget(self.button_container)
        content_layout.addWidget(self.editor_card, 1)

        layout.addWidget(self.content_widget, 1)

        # 添加快捷键
        self.save_shortcut = QShortcut(QKeySequence("Ctrl+S"), self)
        self.save_shortcut.activated.connect(self.trigger_save_button_if_enabled)

        self.clear()

        qconfig.themeChanged.connect(self.on_theme_changed)
        self.destroyed.connect(
            lambda: self.disconnect_theme_changed_signal(self.on_theme_changed)
        )

    def on_theme_changed(self) -> None:
        self.update_all_divider_styles()

    def bind_entry(self, entry: dict[str, Any], index: int) -> None:
        self.current_index = index
        self.saved_entry = {
            "src": str(entry.get("src", "")),
            "info": str(entry.get("info", "")),
        }

        self.row_index_label.setText(f"#{index}")

        self.src_text.blockSignals(True)
        self.info_text.blockSignals(True)

        self.src_text.setPlainText(self.saved_entry["src"])
        self.info_text.setPlainText(self.saved_entry["info"])

        self.src_text.blockSignals(False)
        self.info_text.blockSignals(False)

        self.src_text.set_error(False)
        self.update_button_states()

    def clear(self) -> None:
        self.current_index = -1
        self.saved_entry = None
        self.row_index_label.setText("")
        self.src_text.setPlainText("")
        self.info_text.setPlainText("")
        self.src_text.set_error(False)
        self.update_button_states()

    def set_readonly(self, readonly: bool) -> None:
        self.src_text.setReadOnly(readonly)
        self.info_text.setReadOnly(readonly)
        self.update_button_states()

    def has_unsaved_changes(self) -> bool:
        if self.saved_entry is None:
            return False
        return self.get_current_entry() != self.saved_entry

    def get_current_entry(self) -> dict[str, Any]:
        return {
            "src": self.src_text.toPlainText().strip(),
            "info": self.info_text.toPlainText().strip(),
        }

    def update_button_states(self) -> None:
        self.update_action_button_states(
            has_entry=self.saved_entry is not None,
            has_changes=self.has_unsaved_changes(),
            is_readonly=self.src_text.isReadOnly(),
        )

    def set_src_error(self, has_error: bool) -> None:
        self.src_text.set_error(has_error)
