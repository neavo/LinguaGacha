import threading
from typing import cast

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QFontMetrics
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
from qfluentwidgets import RoundMenu
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig

from model.Item import Item
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CustomTextEdit import CustomTextEdit
from frontend.Proofreading.ProofreadingLabels import ProofreadingLabels
from widget.StatusTag import StatusTagType
from widget.StatusTag import StatusTag


class ProofreadingEditPanel(QWidget):
    """校对任务右侧编辑面板"""

    # 布局常量
    BTN_SIZE = 28
    FONT_SIZE = 12
    ICON_SIZE = 16
    TEXT_MIN_HEIGHT = 84
    STATUS_SCROLL_MAX_LINES = 2
    STATUS_SCROLL_EXTRA_PADDING = 4

    # 防抖时间（毫秒）
    GLOSSARY_STATUS_DELAY_MS = 120

    # 信号定义
    save_requested = pyqtSignal(object, str)
    restore_requested = pyqtSignal()
    copy_src_requested = pyqtSignal(object)
    copy_dst_requested = pyqtSignal(object)
    retranslate_requested = pyqtSignal(object)
    reset_translation_requested = pyqtSignal(object)
    glossary_status_computed = pyqtSignal(object)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.current_item: Item | None = None
        self.saved_text = ""
        self.result_checker: ResultChecker | None = None
        self.file_path_full_text = ""
        self.dividers: list[QWidget] = []

        # 输入过程中不做重检查；仅在离开编辑框后再计算。
        self.glossary_status_dirty: bool = False
        self.glossary_status_token: int = 0
        self.glossary_status_checker_id: int = 0

        self.glossary_status_timer = QTimer(self)
        self.glossary_status_timer.setSingleShot(True)
        self.glossary_status_timer.timeout.connect(self.start_glossary_status_compute)

        self.glossary_status_computed.connect(self.on_glossary_status_computed)
        self.init_ui()

    @staticmethod
    def normalize_text(text: str) -> str:
        # Qt 编辑器内部统一使用 \n，Windows 数据可能是 \r\n；归一化后才能正确判定 dirty。
        return text.replace("\r\n", "\n").replace("\r", "\n")

    def init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

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
        icon.setFixedSize(self.ICON_SIZE, self.ICON_SIZE)
        file_layout.addWidget(icon)
        self.file_path_label = CaptionLabel("", self.file_card)
        self.file_path_label.setTextColor(QColor(128, 128, 128), QColor(128, 128, 128))
        self.file_path_label.setMinimumWidth(1)
        self.file_path_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        label_font = QFont(self.file_path_label.font())
        label_font.setPixelSize(self.FONT_SIZE)
        self.file_path_label.setFont(label_font)
        file_layout.addWidget(self.file_path_label, 1)

        # 右上角条目序号（纯文本）。
        self.row_index_label = CaptionLabel("", self.file_card)
        self.row_index_label.setAlignment(
            cast(
                Qt.AlignmentFlag,
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
            )
        )
        self.row_index_label.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Preferred)
        self.row_index_label.setMinimumWidth(40)
        idx_font = QFont(self.row_index_label.font())
        idx_font.setPixelSize(self.FONT_SIZE)
        idx_font.setBold(True)
        self.row_index_label.setFont(idx_font)
        # 序号需要在亮/暗主题下都足够醒目。
        self.row_index_label.setTextColor(QColor(214, 143, 0), QColor(255, 183, 77))
        file_layout.addWidget(self.row_index_label)
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
        # 状态区不需要额外背景，直接使用卡片底色。
        self.status_scroll.setStyleSheet(
            "QScrollArea { background: transparent; }"
            "QScrollArea QWidget { background: transparent; }"
            "QScrollArea QAbstractScrollArea::viewport { background: transparent; }"
        )

        self.status_widget = QWidget(self.status_scroll)
        self.status_layout = QVBoxLayout(self.status_widget)
        self.status_layout.setContentsMargins(0, 0, 0, 0)
        self.status_layout.setSpacing(0)
        # 状态标签通过 show/hide 控制显示，FlowLayout 需要 tight 模式才会跳过隐藏控件。
        self.status_flow = FlowLayout(needAni=False, isTight=True)
        self.status_flow.setContentsMargins(0, 0, 0, 0)
        self.status_flow.setSpacing(6)

        self.status_layout.addLayout(self.status_flow)

        # 状态标签的种类是有限的，直接预创建并通过 show/hide 控制。
        self.translation_status_tag = self.create_status_tag("", StatusTagType.INFO)
        self.status_flow.addWidget(self.translation_status_tag)

        self.glossary_status_tag = self.create_status_tag("", StatusTagType.INFO)
        # 术语状态标签需要稳定的 hover 才能展示 tooltip，但默认禁用。
        # 这里单独启用该标签，且不绑定点击行为。
        self.glossary_status_tag.setEnabled(True)
        self.glossary_status_tag.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.glossary_status_tag.installEventFilter(
            ToolTipFilter(self.glossary_status_tag, 300, ToolTipPosition.TOP)
        )
        self.status_flow.addWidget(self.glossary_status_tag)

        self.warning_tags: dict[WarningType, StatusTag] = {}
        for warning in (
            WarningType.KANA,
            WarningType.HANGEUL,
            WarningType.TEXT_PRESERVE,
            WarningType.SIMILARITY,
            WarningType.RETRY_THRESHOLD,
        ):
            tag = self.create_status_tag("", StatusTagType.INFO)
            tag.hide()
            self.warning_tags[warning] = tag
            self.status_flow.addWidget(tag)

        self.status_scroll.setWidget(self.status_widget)

        self.src_text = CustomTextEdit(self.editor_card)
        self.src_text.setReadOnly(True)
        src_font = QFont(self.src_text.font())
        src_font.setPixelSize(self.FONT_SIZE)
        self.src_text.setFont(src_font)
        # 默认更紧凑，且允许窗口变矮时继续压缩，避免右侧整体产生滚动条。
        self.src_text.setMinimumHeight(self.TEXT_MIN_HEIGHT)
        self.src_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.src_text.setProperty("compact", True)
        editor_layout.addWidget(self.src_text, 1)

        editor_layout.addWidget(self.build_divider(self.editor_card))

        self.dst_text = CustomTextEdit(self.editor_card)
        dst_font = QFont(self.dst_text.font())
        dst_font.setPixelSize(self.FONT_SIZE)
        self.dst_text.setFont(dst_font)
        self.dst_text.setMinimumHeight(self.TEXT_MIN_HEIGHT)
        self.dst_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.dst_text.setProperty("compact", True)
        self.dst_text.textChanged.connect(self.on_dst_text_changed)
        # 仅用于触发较重的术语状态检查，不用于自动保存。
        self.dst_text.set_on_focus_out(self.on_dst_focus_out)
        editor_layout.addWidget(self.dst_text, 1)
        editor_layout.addSpacing(10)
        editor_layout.addWidget(self.status_scroll)

        # 按钮区（状态区下方，卡片内部）
        editor_layout.addWidget(self.build_divider(self.editor_card))
        self.button_container = QWidget(self.editor_card)
        button_layout = QHBoxLayout(self.button_container)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(0)

        self.btn_restore = TransparentPushButton(self.button_container)
        self.btn_restore.setIcon(FluentIcon.HISTORY)
        self.btn_restore.setText(Localizer.get().proofreading_page_restore)
        self.btn_restore.clicked.connect(self.on_restore_clicked)
        self.btn_restore.setEnabled(False)
        self.apply_fixed_button_style(self.btn_restore)
        button_layout.addWidget(self.btn_restore, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        self.btn_save = TransparentPushButton(self.button_container)
        self.btn_save.setIcon(FluentIcon.SAVE)
        self.btn_save.setText(Localizer.get().proofreading_page_save)
        self.btn_save.clicked.connect(self.on_save_clicked)
        self.btn_save.setEnabled(False)
        self.apply_fixed_button_style(self.btn_save)
        button_layout.addWidget(self.btn_save, 1)

        button_layout.addWidget(self.build_vertical_divider(self.button_container))

        # 操作按钮（移到底部，与编辑区按钮同一尺寸体系）
        self.more_button = TransparentPushButton(self.button_container)
        self.more_button.setIcon(FluentIcon.MORE)
        self.more_button.setText(Localizer.get().proofreading_page_more)
        self.apply_fixed_button_style(self.more_button)
        self.more_button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.more_button.clicked.connect(self.on_more_clicked)
        self.more_button.setEnabled(False)
        button_layout.addWidget(self.more_button, 1)

        editor_layout.addWidget(self.button_container)

        content_layout.addWidget(self.editor_card, 1)

        layout.addWidget(self.content_widget, 1)

        # 初始为空态：保留文本框可见，但强制只读与禁用写操作入口。
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
        self.schedule_status_height_refresh()

    def update_all_divider_styles(self) -> None:
        # 避免 lambda 捕获局部 widget 导致销毁后回调；统一在面板维度刷新样式。
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

    def set_result_checker(self, checker: ResultChecker | None) -> None:
        self.result_checker = checker
        if self.current_item is None:
            return
        self.glossary_status_dirty = True
        self.set_status_tag_visible(self.glossary_status_tag, False)
        QTimer.singleShot(0, self.start_glossary_status_compute)

    def bind_item(self, item: Item, index: int, warnings: list[WarningType]) -> None:
        self.current_item = item
        self.src_text.setFocusPolicy(Qt.FocusPolicy.ClickFocus)
        self.dst_text.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

        self.file_path_full_text = item.get_file_path()
        self.file_path_label.setToolTip(self.file_path_full_text)
        self.row_index_label.setText(f"#{index}" if index > 0 else "")
        self.schedule_file_path_elide_refresh()
        self.more_button.setEnabled(True)

        self.src_text.blockSignals(True)
        self.dst_text.blockSignals(True)
        self.src_text.setPlainText(item.get_src())
        self.dst_text.setPlainText(item.get_dst())
        self.src_text.blockSignals(False)
        self.dst_text.blockSignals(False)

        # 以 Qt 实际显示/存储的文本为准，避免 CRLF/LF 差异导致“刚载入就 dirty”。
        self.saved_text = self.dst_text.toPlainText()
        # NOTE: Qt 文档的 modified 状态在此不作为权威来源，避免因 stubs 差异引入类型报错。

        self.update_button_states()
        self.refresh_status_tags(item, warnings)
        self.schedule_status_height_refresh()
        # 先隐藏术语状态标签，等异步计算完成后再显示。
        self.set_status_tag_visible(self.glossary_status_tag, False)
        self.glossary_status_dirty = True
        self.glossary_status_timer.stop()
        QTimer.singleShot(0, self.start_glossary_status_compute)

    def clear(self) -> None:
        self.current_item = None
        self.saved_text = ""
        self.glossary_status_dirty = False
        self.glossary_status_timer.stop()
        self.file_path_full_text = ""
        self.file_path_label.setToolTip("")
        self.file_path_label.setText("")
        self.row_index_label.setText("")
        self.more_button.setEnabled(False)
        # 空态下不接受焦点，避免点击时出现闪烁的焦点动效。
        self.src_text.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.dst_text.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.src_text.clearFocus()
        self.dst_text.clearFocus()
        self.src_text.setPlainText("")
        self.dst_text.setPlainText("")
        self.clear_status_tags()
        # 空态也保留文本框，但不展示术语状态，避免占位信息造成困扰。
        self.set_status_tag_visible(self.glossary_status_tag, False)
        self.schedule_status_height_refresh()
        self.clear_glossary_status()
        # 无条目时强制只读，避免用户在空态输入造成误解。
        self.set_readonly(True)

    def set_readonly(self, readonly: bool) -> None:
        # 没有绑定条目时始终只读；外部传入的 readonly 仅用于“有条目但需要锁定”的场景。
        effective_readonly = readonly or self.current_item is None
        self.dst_text.setReadOnly(effective_readonly)
        # “更多”菜单包含写操作入口，只读时应整体禁用按钮，避免仍可点击弹出菜单。
        self.more_button.setEnabled(
            self.current_item is not None and not effective_readonly
        )
        self.update_button_states()

    def on_more_clicked(self) -> None:
        item = self.current_item
        if item is None:
            return

        menu = RoundMenu("", self.more_button)

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

    def schedule_file_path_elide_refresh(self) -> None:
        QTimer.singleShot(0, self.refresh_file_path_elide)

    def refresh_file_path_elide(self) -> None:
        text = self.file_path_full_text
        if not text:
            self.file_path_label.setText("")
            return

        width = self.file_path_label.width()
        if width <= 2:
            self.file_path_label.setText(text)
            return

        metrics = QFontMetrics(self.file_path_label.font())
        self.file_path_label.setText(
            metrics.elidedText(text, Qt.TextElideMode.ElideRight, width)
        )

    def resizeEvent(self, a0) -> None:
        super().resizeEvent(a0)
        self.schedule_file_path_elide_refresh()

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
        # 使用更轻的分隔线减少高度开销，同时兼容亮/暗主题。
        color = "rgba(255, 255, 255, 0.08)" if isDarkTheme() else "rgba(0, 0, 0, 0.08)"
        line.setStyleSheet(f"QWidget {{ background-color: {color}; }}")

    def get_current_text(self) -> str:
        return self.dst_text.toPlainText()

    def has_unsaved_changes(self) -> bool:
        if not self.current_item:
            return False
        return self.normalize_text(self.get_current_text()) != self.normalize_text(
            self.saved_text
        )

    def apply_saved_state(self) -> None:
        self.saved_text = self.get_current_text()
        # NOTE: 同上。
        self.update_button_states()

    def update_button_states(self) -> None:
        """根据是否有未保存修改更新按钮启用状态"""
        has_changes = self.has_unsaved_changes()
        is_readonly = self.dst_text.isReadOnly()
        # 只读模式下按钮始终禁用；非只读时根据是否有修改决定
        self.btn_save.setEnabled(has_changes and not is_readonly)
        self.btn_restore.setEnabled(has_changes and not is_readonly)

    def on_dst_text_changed(self) -> None:
        if not self.current_item:
            return

        self.update_button_states()
        # 输入过程只标记 dirty，不做重检查；离开编辑框后再异步计算。
        self.glossary_status_dirty = True
        self.set_status_tag_visible(self.glossary_status_tag, False)

    def on_restore_clicked(self) -> None:
        if not self.current_item:
            return
        self.dst_text.blockSignals(True)
        self.dst_text.setPlainText(self.saved_text)
        self.dst_text.blockSignals(False)
        self.update_button_states()
        self.glossary_status_dirty = True
        self.set_status_tag_visible(self.glossary_status_tag, False)
        QTimer.singleShot(0, self.start_glossary_status_compute)
        self.restore_requested.emit()

    def on_save_clicked(self) -> None:
        if not self.current_item:
            return
        self.save_requested.emit(self.current_item, self.get_current_text())

    def on_dst_focus_out(self) -> None:
        """译文框焦点离开后触发重检查（不做保存）。"""
        if not self.current_item:
            return
        if self.dst_text.isReadOnly():
            return
        if not self.glossary_status_dirty:
            return

        # 延迟一帧，避免点击动作被同步计算卡住。
        self.glossary_status_timer.start(self.GLOSSARY_STATUS_DELAY_MS)

    def refresh_status_tags(self, item: Item, warnings: list[WarningType]) -> None:
        self.clear_status_tags()

        # 统一从 Labels 层取文案与类型，避免多处维护导致颜色/文本漂移。
        status_text, tag_type = ProofreadingLabels.get_status_tag_spec(
            item.get_status()
        )
        self.translation_status_tag.setText(status_text)
        self.translation_status_tag.set_type(tag_type)
        self.set_status_tag_visible(self.translation_status_tag, True)

        if warnings:
            for warning in warnings:
                tag = self.warning_tags.get(warning)
                if tag is None:
                    continue
                text, warn_tag_type = ProofreadingLabels.get_warning_tag_spec(warning)
                tag.setText(text)
                tag.set_type(warn_tag_type)
                self.set_status_tag_visible(tag, True)
        else:
            for tag in self.warning_tags.values():
                self.set_status_tag_visible(tag, False)

        self.schedule_status_height_refresh()

        # 术语状态不依赖 warning_map；绑定/编辑后在焦点离开时再计算。

    def clear_status_tags(self) -> None:
        # 标签统一预创建，这里只负责隐藏“动态部分”，不做增删。
        self.set_status_tag_visible(self.translation_status_tag, False)
        for tag in self.warning_tags.values():
            self.set_status_tag_visible(tag, False)

    def schedule_status_height_refresh(self) -> None:
        QTimer.singleShot(0, self.refresh_status_scroll_height)

    def refresh_status_scroll_height(self) -> None:
        # FlowLayout(heightForWidth) 会按当前宽度计算实际高度，且 tight 模式会跳过隐藏控件。
        probe = self.create_status_tag("A", StatusTagType.INFO)
        line_height = max(1, probe.sizeHint().height())
        probe.deleteLater()

        spacing = self.status_flow.spacing()
        max_lines = self.STATUS_SCROLL_MAX_LINES
        max_height = (
            line_height * max_lines
            + spacing * max(0, max_lines - 1)
            + self.STATUS_SCROLL_EXTRA_PADDING
        )

        # 预留 2 行空间，视觉上不显得拥挤；超过 2 行时由滚动区域内部处理。
        self.status_scroll.setFixedHeight(max_height)

    def create_status_tag(self, text: str, tag_type: StatusTagType) -> StatusTag:
        tag = StatusTag(text=text, type=tag_type, parent=self)
        tag.set_font_size(self.FONT_SIZE)
        return tag

    def set_status_tag_visible(self, tag: StatusTag, visible: bool) -> None:
        """隐藏/显示状态标签。

        FlowLayout 使用 tight 模式时会自动跳过隐藏控件，不需要额外篡改尺寸。
        """
        tag.setVisible(visible)
        self.status_flow.invalidate()
        self.status_widget.adjustSize()

    def start_glossary_status_compute(self) -> None:
        item = self.current_item
        checker = self.result_checker

        if item is None:
            return

        # 关闭术语表功能或未准备数据时，按“无术语”处理。
        if not DataManager.get().get_glossary_enable() or checker is None:
            self.clear_glossary_status()
            self.set_status_tag_visible(self.glossary_status_tag, True)
            self.glossary_status_dirty = False
            return
        if not checker.prepared_glossary_data:
            self.clear_glossary_status()
            self.set_status_tag_visible(self.glossary_status_tag, True)
            self.glossary_status_dirty = False
            return

        self.glossary_status_token += 1
        token = self.glossary_status_token
        item_id = id(item)
        checker_id = id(checker)
        src_text = self.src_text.toPlainText()
        dst_text = self.dst_text.toPlainText()
        self.glossary_status_checker_id = checker_id

        def task() -> None:
            try:
                temp_item = Item()
                temp_item.set_src(src_text)
                temp_item.set_dst(dst_text)

                src_repl, dst_repl = checker.get_replaced_text(temp_item)
                applied: list[tuple[str, str]] = []
                failed: list[tuple[str, str]] = []

                for term in checker.prepared_glossary_data:
                    glossary_src = term.get("src", "")
                    glossary_dst = term.get("dst", "")
                    if not glossary_src or glossary_src not in src_repl:
                        continue
                    # 与 ResultChecker 保持一致：空 dst 条目不参与判断。
                    if not glossary_dst:
                        continue
                    if glossary_dst in dst_repl:
                        applied.append((glossary_src, glossary_dst))
                    else:
                        failed.append((glossary_src, glossary_dst))

                payload = {
                    "token": token,
                    "item_id": item_id,
                    "checker_id": checker_id,
                    "applied": applied,
                    "failed": failed,
                }
                self.glossary_status_computed.emit(payload)
            except Exception:
                # 术语状态异常不应影响编辑；失败时保持隐藏。
                self.glossary_status_computed.emit(
                    {
                        "token": token,
                        "item_id": item_id,
                        "checker_id": checker_id,
                        "applied": [],
                        "failed": [],
                        "failed_compute": True,
                    }
                )

        threading.Thread(target=task, daemon=True).start()

    def clear_glossary_status(self) -> None:
        self.glossary_status_tag.setText(
            Localizer.get().proofreading_page_glossary_none
        )
        self.glossary_status_tag.set_type(StatusTagType.INFO)
        self.glossary_status_tag.setToolTip("")

    def on_glossary_status_computed(self, payload: dict) -> None:
        token = int(payload.get("token", 0))
        if token != self.glossary_status_token:
            return
        if id(self.current_item) != int(payload.get("item_id", 0)):
            return
        if self.glossary_status_checker_id != int(payload.get("checker_id", 0)):
            return

        applied = payload.get("applied", [])
        failed = payload.get("failed", [])
        if not applied and not failed:
            self.set_status_tag_visible(self.glossary_status_tag, False)
            self.glossary_status_dirty = False
            return

        if failed and not applied:
            self.glossary_status_tag.setText(
                Localizer.get().proofreading_page_glossary_miss
            )
            self.glossary_status_tag.set_type(StatusTagType.ERROR)
        elif failed:
            self.glossary_status_tag.setText(
                Localizer.get().proofreading_page_glossary_partial
            )
            self.glossary_status_tag.set_type(StatusTagType.WARNING)
        else:
            self.glossary_status_tag.setText(
                Localizer.get().proofreading_page_glossary_ok
            )
            self.glossary_status_tag.set_type(StatusTagType.SUCCESS)

        tooltip: list[str] = []
        if applied:
            tooltip.append(Localizer.get().proofreading_page_glossary_tooltip_applied)
            tooltip.extend([f"{src} -> {dst}" for src, dst in applied])
        if failed:
            if tooltip:
                tooltip.append("")
            tooltip.append(Localizer.get().proofreading_page_glossary_tooltip_failed)
            tooltip.extend([f"{src} -> {dst}" for src, dst in failed])
        self.glossary_status_tag.setToolTip("\n".join(tooltip))
        self.set_status_tag_visible(self.glossary_status_tag, True)
        self.glossary_status_dirty = False
