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
from widget.RuleWidget import RuleWidget


class TextReplacementEditPanel(QWidget):
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
        self.dst_edit = CustomLineEdit(self.card)
        self.add_labeled_row(
            card_layout,
            Localizer.get().pre_translation_replacement_page_table_row_01,
            self.src_edit,
        )
        self.add_labeled_row(
            card_layout,
            Localizer.get().pre_translation_replacement_page_table_row_02,
            self.dst_edit,
        )

        self.rule_widget = RuleWidget(
            parent=self.card,
            show_regex=True,
            show_case_sensitive=True,
            regex_enabled=False,
            case_sensitive_enabled=False,
            on_changed=lambda regex, case: self.on_rule_changed(regex, case),
        )
        self.add_labeled_row(
            card_layout,
            Localizer.get().pre_translation_replacement_page_table_row_03,
            self.rule_widget,
        )

        self.src_edit.textChanged.connect(self.update_button_states)
        self.dst_edit.textChanged.connect(self.update_button_states)

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
            "dst": str(entry.get("dst", "")),
            "regex": bool(entry.get("regex", False)),
            "case_sensitive": bool(entry.get("case_sensitive", False)),
        }

        self.index_label.setText(f"#{index}")

        self.blockSignals(True)
        self.src_edit.setText(self.saved_entry["src"])
        self.dst_edit.setText(self.saved_entry["dst"])
        self.rule_widget.set_regex_enabled(self.saved_entry["regex"])
        self.rule_widget.set_case_sensitive_enabled(self.saved_entry["case_sensitive"])
        self.blockSignals(False)

        self.src_edit.set_error(False)
        self.update_button_states()

    def clear(self) -> None:
        self.current_index = -1
        self.saved_entry = None
        self.index_label.setText("")
        self.src_edit.setText("")
        self.dst_edit.setText("")
        self.rule_widget.set_regex_enabled(False)
        self.rule_widget.set_case_sensitive_enabled(False)
        self.src_edit.set_error(False)
        self.update_button_states()

    def set_readonly(self, readonly: bool) -> None:
        self.src_edit.setReadOnly(readonly)
        self.dst_edit.setReadOnly(readonly)
        self.rule_widget.setEnabled(not readonly)
        self.update_button_states()

    def on_rule_changed(self, regex: bool, case_sensitive: bool) -> None:
        del regex
        del case_sensitive
        self.update_button_states()

    def has_unsaved_changes(self) -> bool:
        if self.saved_entry is None:
            return False
        return self.get_current_entry() != self.saved_entry

    def get_current_entry(self) -> dict[str, Any]:
        return {
            "src": self.src_edit.text().strip(),
            "dst": self.dst_edit.text().strip(),
            "regex": self.rule_widget.get_regex_enabled(),
            "case_sensitive": self.rule_widget.get_case_sensitive_enabled(),
        }

    def update_button_states(self) -> None:
        has_entry = self.saved_entry is not None
        has_changes = self.has_unsaved_changes()
        is_readonly = self.src_edit.isReadOnly()
        self.btn_save.setEnabled(has_entry and has_changes and not is_readonly)
        self.btn_delete.setEnabled(has_entry and not is_readonly)

    def set_src_error(self, has_error: bool) -> None:
        self.src_edit.set_error(has_error)
