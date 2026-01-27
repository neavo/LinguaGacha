from types import MethodType

from PyQt5.QtCore import QTimer
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QPaintEvent
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QTextCharFormat
from PyQt5.QtGui import QTextCursor
from PyQt5.QtWidgets import QFrame
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QPlainTextEdit
from PyQt5.QtWidgets import QSizePolicy
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FlowLayout
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import PillPushButton
from qfluentwidgets import PrimaryPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import TogglePushButton
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig
from qfluentwidgets import themeColor

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.QualityRuleManager import QualityRuleManager
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CustomTextEdit import CustomTextEdit


def paint_status_pill(pill: PillPushButton, e: QPaintEvent) -> None:
    painter = QPainter(pill)
    painter.setRenderHints(QPainter.Antialiasing)

    is_dark = isDarkTheme()
    kind = str(pill.property("kind") or "neutral")

    palette: dict[str, tuple[QColor, QColor, QColor, QColor]] = {
        "success": (
            QColor(16, 185, 129, 41),
            QColor(167, 243, 208),
            QColor(6, 95, 70),
            QColor(209, 250, 229),
        ),
        "warn": (
            QColor(245, 158, 11, 41),
            QColor(253, 230, 138),
            QColor(146, 64, 14),
            QColor(254, 243, 199),
        ),
        "danger": (
            QColor(239, 68, 68, 41),
            QColor(254, 202, 202),
            QColor(127, 29, 29),
            QColor(254, 226, 226),
        ),
        "neutral": (
            QColor(148, 163, 184, 46),
            QColor(226, 232, 240),
            QColor(71, 85, 105),
            QColor(241, 245, 249),
        ),
    }

    bg, border, light_color, dark_color = palette.get(kind, palette["neutral"])
    text_color = dark_color if is_dark else light_color

    rect = pill.rect().adjusted(1, 1, -1, -1)
    r = rect.height() / 2
    painter.setPen(border)
    painter.setBrush(bg)
    painter.drawRoundedRect(rect, r, r)

    # WHY: 背景由我们绘制；文字/图标绘制复用库实现，减少维护。
    pill.setStyleSheet(
        "PillPushButton { background: transparent; border: none; }"
        f"PillPushButton {{ color: {text_color.name()}; font-size: 12px; padding: 2px 8px; }}"
    )
    TogglePushButton.paintEvent(pill, e)


class ProofreadingEditPanel(QWidget):
    """校对任务右侧编辑面板"""

    save_requested = pyqtSignal(object, str)
    restore_requested = pyqtSignal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.current_item: Item | None = None
        self.saved_text = ""
        self.result_checker: ResultChecker | None = None
        self.highlight_timer = QTimer(self)
        self.highlight_timer.setSingleShot(True)
        self.highlight_timer.timeout.connect(self.apply_glossary_highlight)
        self.init_ui()

    def init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.empty_state = QWidget(self)
        empty_layout = QVBoxLayout(self.empty_state)
        empty_layout.setContentsMargins(16, 16, 16, 16)
        empty_layout.setSpacing(8)
        empty_layout.addStretch(1)
        empty_label = CaptionLabel(Localizer.get().proofreading_page_no_review_items)
        empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.addWidget(empty_label)
        empty_layout.addStretch(1)

        self.content_widget = QWidget(self)
        content_layout = QVBoxLayout(self.content_widget)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(8)

        # 文件路径与序号
        self.file_card = CardWidget(self.content_widget)
        self.file_card.setBorderRadius(4)
        file_layout = QHBoxLayout(self.file_card)
        file_layout.setContentsMargins(12, 8, 12, 8)
        file_layout.setSpacing(8)
        icon = IconWidget(FluentIcon.DOCUMENT)
        icon.setFixedSize(16, 16)
        file_layout.addWidget(icon)
        self.file_path_label = CaptionLabel("", self.file_card)
        self.file_path_label.setTextColor(QColor(128, 128, 128), QColor(128, 128, 128))
        self.file_path_label.setMinimumWidth(1)
        self.file_path_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        file_layout.addWidget(self.file_path_label, 1)
        content_layout.addWidget(self.file_card)

        # 合并卡片：状态(最多2行) + 原文 + 译文
        self.editor_card = CardWidget(self.content_widget)
        self.editor_card.setBorderRadius(4)
        editor_layout = QVBoxLayout(self.editor_card)
        editor_layout.setContentsMargins(12, 10, 12, 10)
        editor_layout.setSpacing(6)

        self.status_scroll = SingleDirectionScrollArea(orient=Qt.Orientation.Vertical)
        self.status_scroll.setParent(self.editor_card)
        self.status_scroll.setWidgetResizable(True)
        self.status_scroll.setFrameShape(QFrame.NoFrame)
        self.status_scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.status_scroll.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded
        )
        # WHY: 状态区不需要额外背景，直接使用卡片底色。
        self.status_scroll.setStyleSheet(
            "QScrollArea { background: transparent; }"
            "QScrollArea QWidget { background: transparent; }"
            "QScrollArea QAbstractScrollArea::viewport { background: transparent; }"
        )

        self.status_widget = QWidget(self.status_scroll)
        self.status_layout = QVBoxLayout(self.status_widget)
        self.status_layout.setContentsMargins(0, 0, 0, 0)
        self.status_layout.setSpacing(0)
        # WHY: 状态 pill 通过 show/hide 控制显示，FlowLayout 需要 tight 模式才会跳过隐藏控件。
        self.status_flow = FlowLayout(needAni=False, isTight=True)
        self.status_flow.setContentsMargins(0, 0, 0, 0)
        self.status_flow.setSpacing(6)

        self.status_layout.addLayout(self.status_flow)

        # WHY: 状态 pill 的种类是有限的，直接预创建并通过 show/hide 控制。
        # 编辑状态放最前面，满足“从左到右”的语义顺序。
        self.edit_state_pill = self.create_status_pill("", "neutral")
        self.edit_state_pill.hide()
        self.status_flow.addWidget(self.edit_state_pill)

        self.translation_status_pill = self.create_status_pill("", "neutral")
        self.status_flow.addWidget(self.translation_status_pill)

        self.warning_pills: dict[WarningType, PillPushButton] = {}
        for warning in (
            WarningType.KANA,
            WarningType.HANGEUL,
            WarningType.TEXT_PRESERVE,
            WarningType.SIMILARITY,
            WarningType.GLOSSARY,
            WarningType.RETRY_THRESHOLD,
        ):
            pill = self.create_status_pill("", "neutral")
            pill.hide()
            self.warning_pills[warning] = pill
            self.status_flow.addWidget(pill)

        self.no_warning_pill = self.create_status_pill(
            Localizer.get().proofreading_page_filter_no_warning, "neutral"
        )
        self.no_warning_pill.hide()
        self.status_flow.addWidget(self.no_warning_pill)

        self.status_scroll.setWidget(self.status_widget)

        self.src_text = CustomTextEdit(self.editor_card)
        self.src_text.setReadOnly(True)
        # WHY: 默认更紧凑，且允许窗口变矮时继续压缩，避免右侧整体产生滚动条。
        self.src_text.setMinimumHeight(84)
        self.src_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.src_text.setProperty("compact", True)
        editor_layout.addWidget(self.src_text, 1)

        editor_layout.addWidget(self.build_divider(self.editor_card))

        self.dst_text = CustomTextEdit(self.editor_card)
        self.dst_text.setMinimumHeight(84)
        self.dst_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.dst_text.setProperty("compact", True)
        self.dst_text.textChanged.connect(self.on_dst_text_changed)
        editor_layout.addWidget(self.dst_text, 1)

        editor_layout.addWidget(self.build_divider(self.editor_card))
        editor_layout.addWidget(self.status_scroll)

        content_layout.addWidget(self.editor_card, 1)

        layout.addWidget(self.empty_state, 1)
        layout.addWidget(self.content_widget, 1)

        # 底部按钮
        self.footer_widget = QWidget(self)
        footer = QHBoxLayout(self.footer_widget)
        # WHY: 与左侧表格底部对齐，减少额外留白
        footer.setContentsMargins(0, 0, 0, 0)
        footer.setSpacing(8)
        self.btn_restore = PushButton(Localizer.get().proofreading_page_restore)
        self.btn_save = PrimaryPushButton(Localizer.get().proofreading_page_save)
        self.btn_restore.clicked.connect(self.on_restore_clicked)
        self.btn_save.clicked.connect(self.on_save_clicked)
        footer.addWidget(self.btn_restore, 1)
        footer.addWidget(self.btn_save, 1)
        layout.addWidget(self.footer_widget)

        self.set_enabled_state(False)

        qconfig.themeChanged.connect(self.schedule_status_height_refresh)

    def set_result_checker(self, checker: ResultChecker | None) -> None:
        self.result_checker = checker

    def bind_item(self, item: Item, index: int, warnings: list[WarningType]) -> None:
        self.current_item = item
        self.saved_text = item.get_dst()
        self.set_enabled_state(True)

        self.file_path_label.setText(item.get_file_path())

        self.src_text.blockSignals(True)
        self.dst_text.blockSignals(True)
        self.src_text.setPlainText(item.get_src())
        self.dst_text.setPlainText(self.saved_text)
        self.src_text.blockSignals(False)
        self.dst_text.blockSignals(False)

        self.set_save_state("")
        self.refresh_status_tags(item, warnings)
        self.schedule_status_height_refresh()
        self.schedule_highlight_refresh()

    def clear(self) -> None:
        self.current_item = None
        self.saved_text = ""
        self.set_enabled_state(False)
        self.file_path_label.setText("")
        self.src_text.setPlainText("")
        self.dst_text.setPlainText("")
        self.clear_status_tags()
        self.schedule_status_height_refresh()
        self.clear_highlight()
        self.set_save_state("")

    def set_readonly(self, readonly: bool) -> None:
        self.dst_text.setReadOnly(readonly)
        self.btn_save.setEnabled(not readonly)
        self.btn_restore.setEnabled(not readonly)

    def set_enabled_state(self, enabled: bool) -> None:
        self.content_widget.setVisible(enabled)
        self.footer_widget.setVisible(enabled)
        self.empty_state.setVisible(not enabled)
        self.setEnabled(enabled)

    def build_divider(self, parent: QWidget) -> QWidget:
        line = QWidget(parent)
        line.setFixedHeight(1)
        self.update_divider_style(line)
        qconfig.themeChanged.connect(lambda: self.update_divider_style(line))
        return line

    def update_divider_style(self, line: QWidget) -> None:
        # WHY: 使用更轻的分隔线减少高度开销，同时兼容亮/暗主题。
        color = "rgba(255, 255, 255, 0.08)" if isDarkTheme() else "rgba(0, 0, 0, 0.08)"
        line.setStyleSheet(f"QWidget {{ background-color: {color}; }}")

    def get_current_text(self) -> str:
        return self.dst_text.toPlainText()

    def has_unsaved_changes(self) -> bool:
        if not self.current_item:
            return False
        return self.get_current_text() != self.saved_text

    def apply_saved_state(self) -> None:
        self.saved_text = self.get_current_text()
        self.set_save_state(Localizer.get().proofreading_page_saved, state="saved")

    def set_save_state(self, text: str, state: str | None = None) -> None:
        if not text:
            self.set_pill_layout_visible(self.edit_state_pill, False)
            return
        self.edit_state_pill.setText(text)
        self.edit_state_pill.setProperty("state", state or "")
        self.edit_state_pill.setProperty("kind", self.get_kind_by_state(state))
        self.edit_state_pill.update()
        self.set_pill_layout_visible(self.edit_state_pill, True)
        self.schedule_status_height_refresh()

    def on_dst_text_changed(self) -> None:
        if not self.current_item:
            return
        # WHY: 用户输入时仅标记未保存，不直接改写已保存版本
        if self.get_current_text() != self.saved_text:
            self.set_save_state(
                Localizer.get().proofreading_page_unsaved, state="unsaved"
            )
        else:
            self.set_save_state("")
        self.schedule_highlight_refresh()

    def on_restore_clicked(self) -> None:
        if not self.current_item:
            return
        self.dst_text.blockSignals(True)
        self.dst_text.setPlainText(self.saved_text)
        self.dst_text.blockSignals(False)
        self.set_save_state("")
        self.schedule_highlight_refresh()
        self.restore_requested.emit()

    def on_save_clicked(self) -> None:
        if not self.current_item:
            return
        self.save_requested.emit(self.current_item, self.get_current_text())

    def refresh_status_tags(self, item: Item, warnings: list[WarningType]) -> None:
        self.clear_status_tags()

        status_text, status_kind = self.get_status_tag(item.get_status())
        self.translation_status_pill.setText(status_text)
        self.translation_status_pill.setProperty("kind", status_kind)
        self.set_pill_layout_visible(self.translation_status_pill, True)
        self.translation_status_pill.update()

        if warnings:
            self.set_pill_layout_visible(self.no_warning_pill, False)
            for warning in warnings:
                pill = self.warning_pills.get(warning)
                if pill is None:
                    continue
                text, kind = self.get_warning_tag(warning)
                pill.setText(text)
                pill.setProperty("kind", kind)
                self.set_pill_layout_visible(pill, True)
                pill.update()
        else:
            for pill in self.warning_pills.values():
                self.set_pill_layout_visible(pill, False)
            self.set_pill_layout_visible(self.no_warning_pill, True)

        self.schedule_status_height_refresh()

    def clear_status_tags(self) -> None:
        # WHY: pill 统一预创建，这里只负责隐藏“动态部分”，不做增删。
        self.set_pill_layout_visible(self.translation_status_pill, False)
        for pill in self.warning_pills.values():
            self.set_pill_layout_visible(pill, False)
        self.set_pill_layout_visible(self.no_warning_pill, False)

    def schedule_status_height_refresh(self) -> None:
        QTimer.singleShot(0, self.refresh_status_scroll_height)

    def refresh_status_scroll_height(self) -> None:
        # WHY: FlowLayout(heightForWidth) 会按当前宽度计算实际高度，且 tight 模式会跳过隐藏控件。
        probe = self.create_status_pill("A", "neutral")
        line_height = max(1, probe.sizeHint().height())
        probe.deleteLater()

        spacing = self.status_flow.spacing()
        two_lines_height = line_height * 2 + spacing
        max_height = two_lines_height + 4

        # 预留 2 行空间，视觉上不显得拥挤；超过 2 行时由滚动区域内部处理。
        self.status_scroll.setFixedHeight(max_height)

    def create_status_pill(self, text: str, kind: str) -> PillPushButton:
        pill = PillPushButton(text, self)
        pill.setEnabled(False)
        pill.setCheckable(False)
        pill.setCursor(Qt.CursorShape.ArrowCursor)
        pill.setProperty("kind", kind)
        pill.paintEvent = MethodType(paint_status_pill, pill)
        return pill

    def set_pill_layout_visible(self, pill: PillPushButton, visible: bool) -> None:
        """隐藏/显示状态 pill。

        WHY: FlowLayout 使用 tight 模式时会自动跳过隐藏控件，不需要额外篡改尺寸。
        """

        pill.setVisible(visible)

    def get_kind_by_state(self, state: str | None) -> str:
        if state == "saved":
            return "success"
        if state == "unsaved":
            return "danger"
        return "neutral"

    def get_status_tag(self, status: Base.ProjectStatus) -> tuple[str, str]:
        mapping = {
            Base.ProjectStatus.NONE: (
                Localizer.get().proofreading_page_status_none,
                "neutral",
            ),
            Base.ProjectStatus.PROCESSED: (
                Localizer.get().proofreading_page_status_processed,
                "success",
            ),
            Base.ProjectStatus.PROCESSED_IN_PAST: (
                Localizer.get().proofreading_page_status_processed_in_past,
                "neutral",
            ),
            Base.ProjectStatus.ERROR: (
                Localizer.get().proofreading_page_status_error,
                "danger",
            ),
            Base.ProjectStatus.LANGUAGE_SKIPPED: (
                Localizer.get().proofreading_page_status_non_target_source_language,
                "neutral",
            ),
        }
        return mapping.get(status, (str(status), "neutral"))

    def get_warning_tag(self, warning: WarningType) -> tuple[str, str]:
        mapping = {
            WarningType.KANA: (
                Localizer.get().proofreading_page_warning_kana,
                "warn",
            ),
            WarningType.HANGEUL: (
                Localizer.get().proofreading_page_warning_hangeul,
                "warn",
            ),
            WarningType.TEXT_PRESERVE: (
                Localizer.get().proofreading_page_warning_text_preserve,
                "warn",
            ),
            WarningType.SIMILARITY: (
                Localizer.get().proofreading_page_warning_similarity,
                "danger",
            ),
            WarningType.GLOSSARY: (
                Localizer.get().proofreading_page_warning_glossary,
                "warn",
            ),
            WarningType.RETRY_THRESHOLD: (
                Localizer.get().proofreading_page_warning_retry,
                "warn",
            ),
        }
        return mapping.get(warning, (str(warning), "neutral"))

    def schedule_highlight_refresh(self) -> None:
        self.highlight_timer.start(120)

    def clear_highlight(self) -> None:
        self.src_text.setExtraSelections([])
        self.dst_text.setExtraSelections([])

    def apply_glossary_highlight(self) -> None:
        if not self.current_item:
            self.clear_highlight()
            return

        if not QualityRuleManager.get().get_glossary_enable():
            self.clear_highlight()
            return

        glossary_data = []
        if self.result_checker:
            glossary_data = self.result_checker.prepared_glossary_data
        if not glossary_data:
            glossary_items = QualityRuleManager.get().get_glossary()
            glossary_data = [
                {"src": term.get("src", ""), "dst": term.get("dst", "")}
                for term in glossary_items
            ]

        if not glossary_data:
            self.clear_highlight()
            return

        src_text = self.src_text.toPlainText()
        dst_text = self.dst_text.toPlainText()

        temp_item = Item()
        temp_item.set_src(src_text)
        temp_item.set_dst(dst_text)

        failed_terms = set()
        if self.result_checker:
            failed_terms = set(self.result_checker.get_failed_glossary_terms(temp_item))

        src_terms = [term.get("src", "") for term in glossary_data]
        dst_terms = [term.get("dst", "") for term in glossary_data]

        self.src_text.setExtraSelections(
            self.build_highlight_selections(
                self.src_text, src_text, src_terms, failed_terms, highlight_failed=True
            )
        )
        self.dst_text.setExtraSelections(
            self.build_highlight_selections(
                self.dst_text, dst_text, dst_terms, failed_terms, highlight_failed=False
            )
        )

    def build_highlight_selections(
        self,
        editor: CustomTextEdit,
        text: str,
        terms: list[str],
        failed_terms: set[tuple[str, str]],
        highlight_failed: bool,
    ) -> list[QPlainTextEdit.ExtraSelection]:
        selections: list[QPlainTextEdit.ExtraSelection] = []
        failed_src_terms = {src for src, _dst in failed_terms}
        for term in terms:
            if not term:
                continue
            is_failed = highlight_failed and term in failed_src_terms
            start = 0
            while True:
                idx = text.find(term, start)
                if idx < 0:
                    break
                cursor = QTextCursor(editor.document())
                cursor.setPosition(idx)
                cursor.setPosition(idx + len(term), QTextCursor.KeepAnchor)
                selection = QPlainTextEdit.ExtraSelection()
                selection.cursor = cursor
                selection.format = self.get_highlight_format(is_failed)
                selections.append(selection)
                start = idx + len(term)
        return selections

    def get_highlight_format(self, is_failed: bool) -> QTextCharFormat:
        fmt = QTextCharFormat()
        accent = themeColor()
        if isDarkTheme():
            base = QColor(255, 255, 255, 40)
            failed = QColor(248, 113, 113, 120)
        else:
            base = QColor(accent)
            base.setAlpha(40)
            failed = QColor(239, 68, 68, 80)
        fmt.setBackground(failed if is_failed else base)
        return fmt
