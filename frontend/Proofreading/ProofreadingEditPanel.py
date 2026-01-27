from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QFrame
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QSizePolicy
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FlowLayout
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import PillToolButton
from qfluentwidgets import PrimaryPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.QualityRuleManager import QualityRuleManager
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CustomTextEdit import CustomTextEdit
from widget.StatusPillButton import StatusPillButton
from widget.StatusPillButton import StatusPillKind


class ProofreadingEditPanel(QWidget):
    """校对任务右侧编辑面板"""

    GLOSSARY_STATUS_DELAY_MS = 120
    PILL_FONT_SIZE_PX = 12
    STATUS_SCROLL_EXTRA_PADDING_PX = 4
    STATUS_SCROLL_MAX_LINES = 2
    TEXT_MIN_HEIGHT_PX = 84

    save_requested = pyqtSignal(object, str)
    restore_requested = pyqtSignal()
    copy_src_requested = pyqtSignal(object)
    copy_dst_requested = pyqtSignal(object)
    retranslate_requested = pyqtSignal(object)
    reset_translation_requested = pyqtSignal(object)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.current_item: Item | None = None
        self.saved_text = ""
        self.result_checker: ResultChecker | None = None
        self.glossary_status_timer = QTimer(self)
        self.glossary_status_timer.setSingleShot(True)
        self.glossary_status_timer.timeout.connect(self.update_glossary_status)
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

        self.more_button = PillToolButton(FluentIcon.MORE, self.file_card)
        # WHY: 仅作为菜单入口按钮，不需要“点亮/选中”的切换效果。
        self.more_button.setCheckable(False)
        self.more_button.setFixedSize(28, 28)
        self.more_button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.more_button.clicked.connect(self.on_more_clicked)
        file_layout.addWidget(self.more_button, alignment=Qt.AlignmentFlag.AlignVCenter)
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
        self.edit_state_pill = self.create_status_pill("", StatusPillKind.INFO)
        self.edit_state_pill.hide()
        self.status_flow.addWidget(self.edit_state_pill)

        self.translation_status_pill = self.create_status_pill("", StatusPillKind.INFO)
        self.status_flow.addWidget(self.translation_status_pill)

        self.glossary_status_pill = self.create_status_pill("", StatusPillKind.INFO)
        # WHY: 状态 pill 需要稳定的 hover 才能展示 tooltip，但默认禁用。
        # 这里单独启用该 pill，且不绑定点击行为。
        self.glossary_status_pill.setEnabled(True)
        self.glossary_status_pill.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.glossary_status_pill.installEventFilter(
            ToolTipFilter(self.glossary_status_pill, 300, ToolTipPosition.TOP)
        )
        self.status_flow.addWidget(self.glossary_status_pill)

        self.warning_pills: dict[WarningType, StatusPillButton] = {}
        for warning in (
            WarningType.KANA,
            WarningType.HANGEUL,
            WarningType.TEXT_PRESERVE,
            WarningType.SIMILARITY,
            WarningType.RETRY_THRESHOLD,
        ):
            pill = self.create_status_pill("", StatusPillKind.INFO)
            pill.hide()
            self.warning_pills[warning] = pill
            self.status_flow.addWidget(pill)

        self.no_warning_pill = self.create_status_pill(
            Localizer.get().proofreading_page_filter_no_warning,
            StatusPillKind.INFO,
        )
        self.no_warning_pill.hide()
        self.status_flow.addWidget(self.no_warning_pill)

        self.status_scroll.setWidget(self.status_widget)

        self.src_text = CustomTextEdit(self.editor_card)
        self.src_text.setReadOnly(True)
        # WHY: 默认更紧凑，且允许窗口变矮时继续压缩，避免右侧整体产生滚动条。
        self.src_text.setMinimumHeight(self.TEXT_MIN_HEIGHT_PX)
        self.src_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.src_text.setProperty("compact", True)
        editor_layout.addWidget(self.src_text, 1)

        editor_layout.addWidget(self.build_divider(self.editor_card))

        self.dst_text = CustomTextEdit(self.editor_card)
        self.dst_text.setMinimumHeight(self.TEXT_MIN_HEIGHT_PX)
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
        self.schedule_glossary_status_refresh()

    def bind_item(self, item: Item, index: int, warnings: list[WarningType]) -> None:
        # WHY: 兼容外部回调签名，面板只关心当前 item。
        del index

        self.current_item = item
        self.saved_text = item.get_dst()
        self.set_enabled_state(True)

        self.file_path_label.setText(item.get_file_path())
        self.more_button.setEnabled(True)

        self.src_text.blockSignals(True)
        self.dst_text.blockSignals(True)
        self.src_text.setPlainText(item.get_src())
        self.dst_text.setPlainText(self.saved_text)
        self.src_text.blockSignals(False)
        self.dst_text.blockSignals(False)

        self.set_save_state("")
        self.refresh_status_tags(item, warnings)
        self.schedule_status_height_refresh()
        # 先隐藏术语状态 pill，等异步计算完成后再显示，避免短暂显示旧状态
        self.set_pill_layout_visible(self.glossary_status_pill, False)
        self.schedule_glossary_status_refresh()

    def clear(self) -> None:
        self.current_item = None
        self.saved_text = ""
        self.set_enabled_state(False)
        self.file_path_label.setText("")
        self.more_button.setEnabled(False)
        self.src_text.setPlainText("")
        self.dst_text.setPlainText("")
        self.clear_status_tags()
        self.schedule_status_height_refresh()
        self.clear_glossary_status()
        self.set_save_state("")

    def set_readonly(self, readonly: bool) -> None:
        self.dst_text.setReadOnly(readonly)
        self.btn_save.setEnabled(not readonly)
        self.btn_restore.setEnabled(not readonly)

    def on_more_clicked(self) -> None:
        item = self.current_item
        if item is None:
            return

        menu = RoundMenu("", self.more_button)
        menu.addAction(
            Action(
                FluentIcon.PASTE,
                Localizer.get().proofreading_page_copy_src,
                triggered=lambda: self.copy_src_requested.emit(item),
            )
        )
        menu.addAction(
            Action(
                FluentIcon.COPY,
                Localizer.get().proofreading_page_copy_dst,
                triggered=lambda: self.copy_dst_requested.emit(item),
            )
        )

        action_retranslate = Action(
            FluentIcon.SYNC,
            Localizer.get().proofreading_page_retranslate,
            triggered=lambda: self.retranslate_requested.emit(item),
        )
        action_retranslate.setEnabled(not self.dst_text.isReadOnly())
        menu.addAction(action_retranslate)

        action_reset = Action(
            FluentIcon.DELETE,
            Localizer.get().proofreading_page_reset_translation,
            triggered=lambda: self.reset_translation_requested.emit(item),
        )
        action_reset.setEnabled(not self.dst_text.isReadOnly())
        menu.addAction(action_reset)

        global_pos = self.more_button.mapToGlobal(self.more_button.rect().bottomLeft())
        menu.exec(global_pos)

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
        return bool(self.current_item) and self.get_current_text() != self.saved_text

    def apply_saved_state(self) -> None:
        self.saved_text = self.get_current_text()
        self.set_save_state(Localizer.get().proofreading_page_saved, state="saved")

    def set_save_state(self, text: str, state: str | None = None) -> None:
        if not text:
            self.set_pill_layout_visible(self.edit_state_pill, False)
            return
        self.edit_state_pill.setText(text)
        self.edit_state_pill.setProperty("state", state or "")
        self.edit_state_pill.set_kind(self.get_kind_by_state(state))
        self.set_pill_layout_visible(self.edit_state_pill, True)
        self.schedule_status_height_refresh()

    def on_dst_text_changed(self) -> None:
        if not self.current_item:
            return

        current_text = self.get_current_text()
        # WHY: 用户输入时仅标记未保存，不直接改写已保存版本
        if current_text != self.saved_text:
            self.set_save_state(
                Localizer.get().proofreading_page_unsaved, state="unsaved"
            )
        else:
            self.set_save_state("")
        self.schedule_glossary_status_refresh()

    def on_restore_clicked(self) -> None:
        if not self.current_item:
            return
        self.dst_text.blockSignals(True)
        self.dst_text.setPlainText(self.saved_text)
        self.dst_text.blockSignals(False)
        self.set_save_state("")
        self.schedule_glossary_status_refresh()
        self.restore_requested.emit()

    def on_save_clicked(self) -> None:
        if not self.current_item:
            return
        self.save_requested.emit(self.current_item, self.get_current_text())

    def refresh_status_tags(self, item: Item, warnings: list[WarningType]) -> None:
        self.clear_status_tags()

        status_text, status_kind = self.get_status_tag(item.get_status())
        self.translation_status_pill.setText(status_text)
        self.translation_status_pill.set_kind(status_kind)
        self.set_pill_layout_visible(self.translation_status_pill, True)

        if warnings:
            self.set_pill_layout_visible(self.no_warning_pill, False)
            for warning in warnings:
                pill = self.warning_pills.get(warning)
                if pill is None:
                    continue
                text, kind = self.get_warning_tag(warning)
                pill.setText(text)
                pill.set_kind(kind)
                self.set_pill_layout_visible(pill, True)
        else:
            for pill in self.warning_pills.values():
                self.set_pill_layout_visible(pill, False)
            self.set_pill_layout_visible(self.no_warning_pill, True)

        self.schedule_status_height_refresh()

        # 术语状态不依赖 warning_map，实时基于面板文本计算。
        self.schedule_glossary_status_refresh()

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
        probe = self.create_status_pill("A", StatusPillKind.INFO)
        line_height = max(1, probe.sizeHint().height())
        probe.deleteLater()

        spacing = self.status_flow.spacing()
        max_lines = self.STATUS_SCROLL_MAX_LINES
        max_height = (
            line_height * max_lines
            + spacing * max(0, max_lines - 1)
            + self.STATUS_SCROLL_EXTRA_PADDING_PX
        )

        # 预留 2 行空间，视觉上不显得拥挤；超过 2 行时由滚动区域内部处理。
        self.status_scroll.setFixedHeight(max_height)

    def create_status_pill(self, text: str, kind: StatusPillKind) -> StatusPillButton:
        pill = StatusPillButton(text=text, kind=kind, parent=self)
        pill.set_font_size_px(self.PILL_FONT_SIZE_PX)
        return pill

    def set_pill_layout_visible(self, pill: StatusPillButton, visible: bool) -> None:
        """隐藏/显示状态 pill。

        WHY: FlowLayout 使用 tight 模式时会自动跳过隐藏控件，不需要额外篡改尺寸。
        """

        pill.setVisible(visible)

    def get_kind_by_state(self, state: str | None) -> StatusPillKind:
        if state == "saved":
            return StatusPillKind.SUCCESS
        if state == "unsaved":
            return StatusPillKind.ERROR
        return StatusPillKind.INFO

    def get_status_tag(self, status: Base.ProjectStatus) -> tuple[str, StatusPillKind]:
        mapping = {
            Base.ProjectStatus.NONE: (
                Localizer.get().proofreading_page_status_none,
                StatusPillKind.INFO,
            ),
            Base.ProjectStatus.PROCESSED: (
                Localizer.get().proofreading_page_status_processed,
                StatusPillKind.SUCCESS,
            ),
            Base.ProjectStatus.PROCESSED_IN_PAST: (
                Localizer.get().proofreading_page_status_processed_in_past,
                StatusPillKind.INFO,
            ),
            Base.ProjectStatus.ERROR: (
                Localizer.get().proofreading_page_status_error,
                StatusPillKind.ERROR,
            ),
            Base.ProjectStatus.LANGUAGE_SKIPPED: (
                Localizer.get().proofreading_page_status_non_target_source_language,
                StatusPillKind.INFO,
            ),
        }
        return mapping.get(status, (str(status), StatusPillKind.INFO))

    def get_warning_tag(self, warning: WarningType) -> tuple[str, StatusPillKind]:
        mapping = {
            WarningType.KANA: (
                Localizer.get().proofreading_page_warning_kana,
                StatusPillKind.WARNING,
            ),
            WarningType.HANGEUL: (
                Localizer.get().proofreading_page_warning_hangeul,
                StatusPillKind.WARNING,
            ),
            WarningType.TEXT_PRESERVE: (
                Localizer.get().proofreading_page_warning_text_preserve,
                StatusPillKind.WARNING,
            ),
            WarningType.SIMILARITY: (
                Localizer.get().proofreading_page_warning_similarity,
                StatusPillKind.ERROR,
            ),
            WarningType.GLOSSARY: (
                Localizer.get().proofreading_page_warning_glossary,
                StatusPillKind.WARNING,
            ),
            WarningType.RETRY_THRESHOLD: (
                Localizer.get().proofreading_page_warning_retry,
                StatusPillKind.WARNING,
            ),
        }
        return mapping.get(warning, (str(warning), StatusPillKind.INFO))

    def schedule_glossary_status_refresh(self) -> None:
        self.glossary_status_timer.start(self.GLOSSARY_STATUS_DELAY_MS)

    def clear_glossary_status(self) -> None:
        self.glossary_status_pill.setText(
            Localizer.get().proofreading_page_glossary_none
        )
        self.glossary_status_pill.set_kind(StatusPillKind.INFO)
        self.glossary_status_pill.setToolTip("")

    def update_glossary_status(self) -> None:
        # 关闭术语表功能时，按“无术语”处理。
        if not self.current_item or not QualityRuleManager.get().get_glossary_enable():
            self.clear_glossary_status()
            self.set_pill_layout_visible(self.glossary_status_pill, True)
            return

        checker = self.result_checker
        if checker is None or not checker.prepared_glossary_data:
            self.clear_glossary_status()
            self.set_pill_layout_visible(self.glossary_status_pill, True)
            return

        temp_item = Item()
        temp_item.set_src(self.src_text.toPlainText())
        temp_item.set_dst(self.dst_text.toPlainText())

        src_repl, dst_repl = checker.get_replaced_text(temp_item)
        applied: list[tuple[str, str]] = []
        failed: list[tuple[str, str]] = []

        for term in checker.prepared_glossary_data:
            glossary_src = term.get("src", "")
            glossary_dst = term.get("dst", "")
            if not glossary_src or glossary_src not in src_repl:
                continue
            # 与 ResultChecker 保持一致：空 dst 条目不参与判断
            if not glossary_dst:
                continue

            if glossary_dst in dst_repl:
                applied.append((glossary_src, glossary_dst))
            else:
                failed.append((glossary_src, glossary_dst))

        if not applied and not failed:
            # 没有命中任何术语条目，不显示 pill
            self.set_pill_layout_visible(self.glossary_status_pill, False)
            return

        if failed and not applied:
            # 全部未生效
            self.glossary_status_pill.setText(
                Localizer.get().proofreading_page_glossary_miss
            )
            self.glossary_status_pill.set_kind(StatusPillKind.ERROR)
        elif failed:
            # 部分生效
            self.glossary_status_pill.setText(
                Localizer.get().proofreading_page_glossary_partial
            )
            self.glossary_status_pill.set_kind(StatusPillKind.WARNING)
        else:
            # 全部生效
            self.glossary_status_pill.setText(
                Localizer.get().proofreading_page_glossary_ok
            )
            self.glossary_status_pill.set_kind(StatusPillKind.SUCCESS)

        tooltip = []
        if applied:
            tooltip.append(Localizer.get().proofreading_page_glossary_tooltip_applied)
            tooltip.extend([f"{src} -> {dst}" for src, dst in applied])
        if failed:
            if tooltip:
                tooltip.append("")
            tooltip.append(Localizer.get().proofreading_page_glossary_tooltip_failed)
            tooltip.extend([f"{src} -> {dst}" for src, dst in failed])
        self.glossary_status_pill.setToolTip("\n".join(tooltip))
        self.set_pill_layout_visible(self.glossary_status_pill, True)
