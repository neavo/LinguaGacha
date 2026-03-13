from typing import Any

from PySide6.QtGui import QKeySequence
from PySide6.QtWidgets import QHBoxLayout
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
from widget.RuleWidget import RuleWidget


class TextReplacementEditPanel(QualityRuleEditPanelBase):
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
            Localizer.get().table_col_source,
            self.editor_card,
        )
        self.apply_caption_label_style(self.src_label)
        editor_layout.addWidget(self.src_label)

        self.src_text = CustomTextEdit(self.editor_card)
        self.apply_text_edit_style(self.src_text)
        self.src_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.src_text, 1)

        self.dst_label = CaptionLabel(
            Localizer.get().table_col_replacement,
            self.editor_card,
        )
        self.apply_caption_label_style(self.dst_label)
        editor_layout.addWidget(self.dst_label)

        self.dst_text = CustomTextEdit(self.editor_card)
        self.apply_text_edit_style(self.dst_text)
        self.dst_text.textChanged.connect(self.update_button_states)
        editor_layout.addWidget(self.dst_text, 1)

        editor_layout.addSpacing(6)
        self.rule_label = CaptionLabel(
            Localizer.get().table_col_rule,
            self.editor_card,
        )
        self.apply_caption_label_style(self.rule_label)
        editor_layout.addWidget(self.rule_label)

        status_layout = QHBoxLayout()
        status_layout.setContentsMargins(0, 0, 0, 0)
        status_layout.setSpacing(8)

        self.rule_widget = RuleWidget(
            parent=self.editor_card,
            show_regex=True,
            show_case_sensitive=True,
            regex_enabled=False,
            case_sensitive_enabled=False,
            on_changed=lambda regex, case: self.on_rule_changed(regex, case),
        )
        status_layout.addWidget(self.rule_widget)
        status_layout.addStretch(1)
        editor_layout.addLayout(status_layout)
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
            "dst": str(entry.get("dst", "")),
            "regex": bool(entry.get("regex", False)),
            "case_sensitive": bool(entry.get("case_sensitive", False)),
        }

        self.row_index_label.setText(f"#{index}")

        self.src_text.blockSignals(True)
        self.dst_text.blockSignals(True)
        self.rule_widget.blockSignals(True)

        self.src_text.setPlainText(self.saved_entry["src"])
        self.dst_text.setPlainText(self.saved_entry["dst"])
        self.rule_widget.set_regex_enabled(self.saved_entry["regex"])
        self.rule_widget.set_case_sensitive_enabled(self.saved_entry["case_sensitive"])

        self.src_text.blockSignals(False)
        self.dst_text.blockSignals(False)
        self.rule_widget.blockSignals(False)

        self.src_text.set_error(False)
        self.update_button_states()

    def clear(self) -> None:
        self.current_index = -1
        self.saved_entry = None
        self.row_index_label.setText("")
        self.src_text.setPlainText("")
        self.dst_text.setPlainText("")
        self.rule_widget.set_regex_enabled(False)
        self.rule_widget.set_case_sensitive_enabled(False)
        self.src_text.set_error(False)
        self.update_button_states()

    def set_readonly(self, readonly: bool) -> None:
        self.src_text.setReadOnly(readonly)
        self.dst_text.setReadOnly(readonly)
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
            "src": self.src_text.toPlainText().strip(),
            "dst": self.dst_text.toPlainText().strip(),
            "regex": self.rule_widget.get_regex_enabled(),
            "case_sensitive": self.rule_widget.get_case_sensitive_enabled(),
        }

    def update_button_states(self) -> None:
        self.update_action_button_states(
            has_entry=self.saved_entry is not None,
            has_changes=self.has_unsaved_changes(),
            is_readonly=self.src_text.isReadOnly(),
        )

    def set_src_error(self, has_error: bool) -> None:
        self.src_text.set_error(has_error)
