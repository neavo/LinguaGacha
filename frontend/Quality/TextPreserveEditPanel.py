from typing import Any

from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import TransparentPushButton

from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomLineEdit


class TextPreserveEditPanel(QWidget):
    save_requested = pyqtSignal()
    delete_requested = pyqtSignal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.current_index: int = -1
        self.saved_entry: dict[str, Any] | None = None
        self.init_ui()

    def init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.card = CardWidget(self)
        self.card.setBorderRadius(4)
        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(12, 10, 12, 10)
        card_layout.setSpacing(10)

        header_row = QHBoxLayout()
        header_row.setContentsMargins(0, 0, 0, 0)
        header_row.setSpacing(8)
        self.index_label = CaptionLabel("", self.card)
        self.index_label.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        header_row.addWidget(self.index_label, 1)
        card_layout.addLayout(header_row)

        self.src_edit = CustomLineEdit(self.card)
        self.info_edit = CustomLineEdit(self.card)
        self.add_labeled_row(
            card_layout, Localizer.get().text_preserve_page_table_row_01, self.src_edit
        )
        self.add_labeled_row(
            card_layout, Localizer.get().text_preserve_page_table_row_02, self.info_edit
        )

        self.src_edit.textChanged.connect(self.update_button_states)
        self.info_edit.textChanged.connect(self.update_button_states)

        button_row = QHBoxLayout()
        button_row.setContentsMargins(0, 6, 0, 0)
        button_row.setSpacing(8)

        self.btn_delete = TransparentPushButton(self.card)
        self.btn_delete.setIcon(FluentIcon.DELETE)
        self.btn_delete.setText(Localizer.get().delete)
        self.btn_delete.clicked.connect(lambda: self.delete_requested.emit())
        button_row.addWidget(self.btn_delete)

        self.btn_save = TransparentPushButton(self.card)
        self.btn_save.setIcon(FluentIcon.SAVE)
        self.btn_save.setText(Localizer.get().quality_save)
        self.btn_save.clicked.connect(lambda: self.save_requested.emit())
        button_row.addWidget(self.btn_save)

        button_row.addStretch(1)
        card_layout.addLayout(button_row)

        layout.addWidget(self.card, 1)
        self.clear()

    def add_labeled_row(self, parent: QVBoxLayout, title: str, widget: QWidget) -> None:
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(8)
        label = CaptionLabel(title, self.card)
        label.setMinimumWidth(72)
        label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(label)
        row.addWidget(widget, 1)
        parent.addLayout(row)

    def bind_entry(self, entry: dict[str, Any], index: int) -> None:
        self.current_index = index
        self.saved_entry = {
            "src": str(entry.get("src", "")),
            "info": str(entry.get("info", "")),
        }
        self.index_label.setText(f"#{index}")

        self.blockSignals(True)
        self.src_edit.setText(self.saved_entry["src"])
        self.info_edit.setText(self.saved_entry["info"])
        self.blockSignals(False)

        self.src_edit.set_error(False)
        self.update_button_states()

    def clear(self) -> None:
        self.current_index = -1
        self.saved_entry = None
        self.index_label.setText("")
        self.src_edit.setText("")
        self.info_edit.setText("")
        self.src_edit.set_error(False)
        self.update_button_states()

    def set_readonly(self, readonly: bool) -> None:
        self.src_edit.setReadOnly(readonly)
        self.info_edit.setReadOnly(readonly)
        self.update_button_states()

    def has_unsaved_changes(self) -> bool:
        if self.saved_entry is None:
            return False
        return self.get_current_entry() != self.saved_entry

    def get_current_entry(self) -> dict[str, Any]:
        return {
            "src": self.src_edit.text().strip(),
            "info": self.info_edit.text().strip(),
        }

    def update_button_states(self) -> None:
        has_entry = self.saved_entry is not None
        has_changes = self.has_unsaved_changes()
        is_readonly = self.src_edit.isReadOnly()
        self.btn_save.setEnabled(has_entry and has_changes and not is_readonly)
        self.btn_delete.setEnabled(has_entry and not is_readonly)

    def set_src_error(self, has_error: bool) -> None:
        self.src_edit.set_error(has_error)
