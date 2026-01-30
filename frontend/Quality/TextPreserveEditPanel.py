from typing import Any

from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import TransparentPushButton
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

        self.src_label = CaptionLabel(
            Localizer.get().text_preserve_page_table_row_01, self.editor_card
        )
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
        self.button_container = QWidget(self.editor_card)
        button_layout = QHBoxLayout(self.button_container)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(0)

        self.btn_add = TransparentPushButton(self.button_container)
        self.btn_add.setIcon(FluentIcon.ADD_TO)
        self.btn_add.setText(Localizer.get().add)
        self.btn_add.clicked.connect(lambda: self.add_requested.emit())
        self.apply_button_style(self.btn_add)
        button_layout.addWidget(self.btn_add, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_delete = TransparentPushButton(self.button_container)
        self.btn_delete.setIcon(FluentIcon.DELETE)
        self.btn_delete.setText(Localizer.get().delete)
        self.btn_delete.clicked.connect(lambda: self.delete_requested.emit())
        self.apply_button_style(self.btn_delete)
        button_layout.addWidget(self.btn_delete, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_save = TransparentPushButton(self.button_container)
        self.btn_save.setIcon(FluentIcon.SAVE)
        self.btn_save.setText(Localizer.get().save)
        self.btn_save.clicked.connect(lambda: self.save_requested.emit())
        self.apply_button_style(self.btn_save)
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
        has_entry = self.saved_entry is not None
        has_changes = self.has_unsaved_changes()
        is_readonly = self.src_text.isReadOnly()
        self.btn_add.setEnabled(not is_readonly)
        self.btn_save.setEnabled(has_entry and has_changes and not is_readonly)
        self.btn_delete.setEnabled(has_entry and not is_readonly)

    def set_src_error(self, has_error: bool) -> None:
        self.src_text.set_error(has_error)
