import re
import time
from typing import Callable

from PySide6.QtCore import QAbstractItemModel
from PySide6.QtCore import QItemSelectionModel
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QPersistentModelIndex
from PySide6.QtCore import QSortFilterProxyModel
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal
from PySide6.QtGui import QFont
from PySide6.QtGui import QFontMetrics
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QSizePolicy
from PySide6.QtWidgets import QSpacerItem
from PySide6.QtWidgets import QTableView
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import IconWidget
from qfluentwidgets import PillPushButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import VerticalSeparator

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomLineEdit
from widget.CustomLineEdit import CustomSearchLineEdit

# ==================== 图标常量 ====================

ICON_BACK: BaseIcon = BaseIcon.CIRCLE_ARROW_LEFT  # 搜索栏：返回
ICON_PREV_MATCH: BaseIcon = BaseIcon.CIRCLE_CHEVRON_UP  # 搜索栏：上一个匹配
ICON_NEXT_MATCH: BaseIcon = BaseIcon.CIRCLE_CHEVRON_DOWN  # 搜索栏：下一个匹配
ICON_REPLACE_ARROW: BaseIcon = BaseIcon.ARROW_RIGHT_FROM_LINE  # 替换栏：方向箭头
ICON_REPLACE: BaseIcon = BaseIcon.REPLACE  # 替换按钮图标
ICON_REPLACE_ALL: BaseIcon = BaseIcon.REPLACE_ALL  # 全部替换按钮图标
SEARCH_MODE_INPUT_WIDTH: int = (
    320  # Search 模式输入框固定宽度，避免命中信息变化导致抖动
)
REPLACE_MODE_INPUT_WIDTH: int = 220  # Replace 模式左右输入框等宽
REPLACE_LAYOUT_SPACING: int = 8  # 替换区间距与动作条统一，避免按钮间距突兀
ROOT_LAYOUT_SPACING: int = 12  # 搜索卡根布局主间距
REPLACE_ARROW_COMPENSATION_SPACING: int = 4  # 补齐箭头右侧间距，使其与左侧视觉一致
ACTION_BUTTON_SPACING: int = 4  # 与 CommandBar 操作按钮间距保持一致
REPLACE_ARROW_ICON_SIZE: int = 16  # 箭头图标尺寸
MATCH_INFO_WIDTH_PADDING: int = 12  # 文本测量与实际渲染存在微差，预留安全边距


class SearchCardProxyModel(QSortFilterProxyModel):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.keyword: str = ""
        self.regex_mode: bool = False
        self.columns: tuple[int, ...] = ()
        self.keyword_lower: str = ""
        self.pattern: re.Pattern[str] | None = None

    def set_search(
        self,
        keyword: str,
        *,
        columns: tuple[int, ...],
        regex_mode: bool,
    ) -> None:
        self.keyword = keyword
        self.regex_mode = bool(regex_mode)
        self.columns = columns
        self.keyword_lower = keyword.lower()
        self.pattern = None
        if self.regex_mode and keyword:
            try:
                self.pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                self.pattern = None
        self.invalidateFilter()

    def filterAcceptsRow(
        self,
        source_row: int,
        source_parent: QModelIndex | QPersistentModelIndex,
    ) -> bool:  # noqa: N802
        del source_parent

        keyword = self.keyword
        if not keyword:
            return True

        source = self.sourceModel()
        if source is None:
            return True

        columns = self.columns
        if not columns:
            return True

        texts: list[str] = []
        for col in columns:
            index = source.index(source_row, col)
            value = index.data(int(Qt.ItemDataRole.DisplayRole))
            text = str(value).strip() if value is not None else ""
            if text:
                texts.append(text)

        if not texts:
            return False

        if self.pattern is not None:
            return any(self.pattern.search(text) for text in texts)

        keyword_lower = self.keyword_lower
        return any(keyword_lower in text.lower() for text in texts)


class SearchCard(CardWidget):
    """搜索卡片组件，支持普通/正则搜索模式及上下跳转"""

    search_options_changed = Signal()
    search_triggered = Signal(str, bool)
    replace_triggered = Signal()
    replace_all_triggered = Signal()

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)

        # 搜索选项：False=普通搜索，True=正则搜索
        self.regex_mode: bool = False
        self.replace_mode: bool = False
        self.search_last_trigger_time: float = 0.0
        self.search_last_trigger_keyword: str = ""
        self.search_last_trigger_regex_mode: bool = False
        self.search_trigger_debounce_seconds: float = 0.2

        # 可选：Model/View 绑定模式（QAbstractItemView + QSortFilterProxyModel）。
        self.bound_view: QAbstractItemView | None = None
        self.bound_view_columns: tuple[int, ...] = ()
        self.bound_view_notify: Callable[[str, str], None] | None = None
        self.bound_view_source_model: QAbstractItemModel | None = None
        self.bound_view_proxy: SearchCardProxyModel | None = None
        self.bound_view_matches: list[int] = []
        self.bound_view_current_match_index: int = -1

        # 设置容器布局
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(
            16, 16, 16, 16
        )  # 与 CommandBarCard 保持一致，确保视觉统一
        self.root.setSpacing(ROOT_LAYOUT_SPACING)

        # 1. 返回按钮
        self.back = TransparentPushButton(self)
        self.back.setIcon(ICON_BACK)
        self.back.setText(Localizer.get().back)
        self.root.addWidget(self.back)

        self.sep_after_back = VerticalSeparator()
        self.root.addWidget(self.sep_after_back)

        # 2. 正则模式切换按钮
        self.regex_btn = PillPushButton(Localizer.get().search_regex_btn, self)
        self.regex_btn.setCheckable(True)
        self.regex_btn.clicked.connect(self.on_regex_toggle)
        # 启用 ToolTip 显示，延时 300ms 触发
        self.regex_btn.installEventFilter(
            ToolTipFilter(self.regex_btn, 300, ToolTipPosition.TOP)
        )
        self.update_regex_tooltip()
        self.root.addWidget(self.regex_btn)

        # 3. 搜索输入框
        self.line_edit = CustomSearchLineEdit(self)
        self.line_edit.setFixedWidth(SEARCH_MODE_INPUT_WIDTH)
        self.line_edit.setPlaceholderText(Localizer.get().placeholder)
        self.line_edit.setClearButtonEnabled(True)
        self.line_edit.textChanged.connect(self.update_replace_action_state)
        self.root.addWidget(self.line_edit)

        # 4. 导航按钮
        self.nav_layout = QHBoxLayout()
        self.nav_layout.setContentsMargins(0, 0, 0, 0)
        self.nav_layout.setSpacing(ACTION_BUTTON_SPACING)

        self.prev_btn = TransparentPushButton(Localizer.get().search_prev_btn, self)
        self.prev_btn.setIcon(ICON_PREV_MATCH)
        self.prev_btn.setToolTip(Localizer.get().search_prev_match)
        self.prev_btn.installEventFilter(
            ToolTipFilter(self.prev_btn, 300, ToolTipPosition.TOP)
        )
        self.nav_layout.addWidget(self.prev_btn)

        self.next_btn = TransparentPushButton(Localizer.get().search_next_btn, self)
        self.next_btn.setIcon(ICON_NEXT_MATCH)
        self.next_btn.setToolTip(Localizer.get().search_next_match)
        self.next_btn.installEventFilter(
            ToolTipFilter(self.next_btn, 300, ToolTipPosition.TOP)
        )
        self.nav_layout.addWidget(self.next_btn)
        self.root.addLayout(self.nav_layout)

        # 5. 匹配数量显示
        self.match_label = CaptionLabel(Localizer.get().search_no_result, self)
        self.match_label.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        self.update_match_label_width()

        # 6. 右侧扩展区
        self.right_layout = QHBoxLayout()
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        self.right_layout.setSpacing(8)
        self.root.addLayout(self.right_layout)

        self.replace_layout = QHBoxLayout()
        self.replace_layout.setContentsMargins(0, 0, 0, 0)
        self.replace_layout.setSpacing(REPLACE_LAYOUT_SPACING)
        self.right_layout.addLayout(self.replace_layout)

        # 箭头用于表达“查找词 -> 替换词”的方向，降低误操作成本。
        self.replace_arrow = IconWidget(ICON_REPLACE_ARROW, self)
        self.replace_arrow.setFixedSize(
            REPLACE_ARROW_ICON_SIZE, REPLACE_ARROW_ICON_SIZE
        )
        self.replace_layout.addWidget(self.replace_arrow)
        self.replace_arrow_compensation = QSpacerItem(
            REPLACE_ARROW_COMPENSATION_SPACING,
            0,
            QSizePolicy.Policy.Fixed,
            QSizePolicy.Policy.Minimum,
        )
        self.replace_layout.addSpacerItem(self.replace_arrow_compensation)

        self.replace_line_edit = CustomLineEdit(self)
        self.replace_line_edit.setMinimumWidth(REPLACE_MODE_INPUT_WIDTH)
        self.replace_line_edit.setPlaceholderText(
            Localizer.get().proofreading_page_replace_with_placeholder
        )
        self.replace_layout.addWidget(self.replace_line_edit)

        self.replace_btn = TransparentPushButton(
            Localizer.get().proofreading_page_replace_btn,
            self,
        )
        self.replace_btn.setIcon(ICON_REPLACE)

        self.replace_all_btn = TransparentPushButton(
            Localizer.get().proofreading_page_replace_all_btn,
            self,
        )
        self.replace_all_btn.setIcon(ICON_REPLACE_ALL)

        self.replace_action_layout = QHBoxLayout()
        self.replace_action_layout.setContentsMargins(0, 0, 0, 0)
        self.replace_action_layout.setSpacing(ACTION_BUTTON_SPACING)
        self.replace_action_layout.addWidget(self.replace_btn)
        self.replace_action_layout.addWidget(self.replace_all_btn)
        self.replace_layout.addLayout(self.replace_action_layout)

        self.replace_section_widgets: tuple[QWidget, ...] = (
            self.replace_arrow,
            self.replace_line_edit,
            self.replace_btn,
            self.replace_all_btn,
        )
        self.update_replace_mode_ui()
        self.update_replace_action_state()

        # 除信息文本外，其余控件都贴左布局；仅把信息文本推到最右侧。
        self.root.addStretch(1)
        self.root.addWidget(self.match_label)

    def add_right_widget(self, widget: QWidget) -> None:
        self.right_layout.addWidget(widget)

    def reset_state(self) -> None:
        """重置搜索 UI 状态。

        用于页面禁用/数据重载等场景：不保留关键字/模式/匹配信息。
        """

        self.regex_mode = False
        self.regex_btn.setChecked(False)
        self.update_regex_tooltip()

        self.line_edit.setText("")
        self.replace_line_edit.setText("")
        self.replace_mode = False
        self.update_replace_mode_ui()
        self.update_replace_action_state()
        self.clear_match_info()

        # 若绑定了表格，退出搜索时应恢复表格行可见性。
        self.clear_table_search_state()

        # 重置触发去抖状态，避免“清空后立刻搜索”被误判为重复触发。
        self.search_last_trigger_time = 0.0
        self.search_last_trigger_keyword = ""
        self.search_last_trigger_regex_mode = False

    def set_base_font(self, font: QFont) -> None:
        self.setFont(font)
        self.back.setFont(font)
        self.regex_btn.setFont(font)
        self.line_edit.setFont(font)
        self.replace_line_edit.setFont(font)
        self.replace_btn.setFont(font)
        self.replace_all_btn.setFont(font)
        self.prev_btn.setFont(font)
        self.next_btn.setFont(font)
        self.match_label.setFont(font)
        self.update_match_label_width()

    def update_match_label_width(self) -> None:
        """匹配信息保持自适应宽度，仅设置最小宽度避免文本跳变过大。"""
        no_result_text = Localizer.get().search_no_result

        metrics = QFontMetrics(self.match_label.font())
        self.match_label.setMinimumWidth(
            metrics.horizontalAdvance(no_result_text) + MATCH_INFO_WIDTH_PADDING
        )
        self.match_label.setMaximumWidth(16777215)

    def set_replace_mode(self, replace_mode: bool) -> None:
        """切换查找/替换模式，并通知外部重建命中状态。"""
        new_mode = bool(replace_mode)
        should_emit = self.replace_mode != new_mode
        self.replace_mode = new_mode

        self.update_replace_mode_ui()
        self.update_replace_action_state()
        # 选项切换会改变匹配边界（Search=src|dst，Replace=dst），外部必须重算命中。
        if should_emit:
            self.search_options_changed.emit()

    def is_replace_mode(self) -> bool:
        return self.replace_mode

    def update_replace_mode_ui(self) -> None:
        replace_visible = self.replace_mode
        for widget in self.replace_section_widgets:
            widget.setVisible(replace_visible)

        spacer_width = REPLACE_ARROW_COMPENSATION_SPACING if replace_visible else 0
        self.replace_arrow_compensation.changeSize(
            spacer_width,
            0,
            QSizePolicy.Policy.Fixed,
            QSizePolicy.Policy.Minimum,
        )
        self.replace_layout.invalidate()

        show_search_nav = not self.replace_mode
        # Replace 模式下隐藏上下跳转，释放横向空间给“替换预览”。
        self.prev_btn.setVisible(show_search_nav)
        self.next_btn.setVisible(show_search_nav)
        # Search/Replace 模式都固定输入框宽度，避免右侧信息变动影响输入区。
        line_edit_width = (
            REPLACE_MODE_INPUT_WIDTH if self.replace_mode else SEARCH_MODE_INPUT_WIDTH
        )
        self.line_edit.setFixedWidth(line_edit_width)

    def update_replace_action_state(self) -> None:
        # 替换能力依赖有效关键词，禁用按钮可以减少“空操作”误触。
        can_replace = bool(self.get_keyword())
        if can_replace and self.regex_mode:
            is_valid, _ = self.validate_regex()
            can_replace = is_valid
        self.replace_btn.setEnabled(can_replace)
        self.replace_all_btn.setEnabled(can_replace)

    def on_regex_toggle(self) -> None:
        """正则模式切换逻辑"""
        self.regex_mode = self.regex_btn.isChecked()
        self.update_regex_tooltip()
        self.update_replace_action_state()
        self.search_options_changed.emit()

    def update_regex_tooltip(self) -> None:
        """根据当前模式更新正则按钮的 ToolTip"""
        tooltip = (
            Localizer.get().search_regex_on
            if self.regex_mode
            else Localizer.get().search_regex_off
        )
        self.regex_btn.setToolTip(tooltip)

    def is_regex_mode(self) -> bool:
        """获取当前是否为正则搜索模式"""
        return self.regex_mode

    def get_line_edit(self) -> CustomSearchLineEdit:
        """获取搜索输入框实例"""
        return self.line_edit

    def get_keyword(self) -> str:
        """获取当前搜索关键词，自动去除首尾空格"""
        return self.line_edit.text().strip()

    def get_replace_text(self) -> str:
        """获取替换文本（允许空字符串，代表删除匹配内容）。"""
        return self.replace_line_edit.text()

    def set_match_info(self, current: int, total: int) -> None:
        """更新 UI 显示的匹配进度信息"""
        if total > 0:
            # 使用 Localizer 格式化字符串以支持多语言
            self.match_label.setText(
                Localizer.get().search_match_info.format(current=current, total=total)
            )
        else:
            self.match_label.setText(Localizer.get().search_no_result)

    def clear_match_info(self) -> None:
        """重置匹配信息为默认状态"""
        self.match_label.setText(Localizer.get().search_no_result)

    # ==================== 可选：Model/View 绑定搜索 ====================

    def bind_view(
        self,
        view: QAbstractItemView,
        columns: tuple[int, ...],
        notify: Callable[[str, str], None] | None = None,
    ) -> None:
        self.bound_view_matches = []
        self.bound_view_current_match_index = -1

        self.bound_view = view
        self.bound_view_columns = columns
        self.bound_view_notify = notify

        source_model = view.model()
        if source_model is None:
            self.bound_view_source_model = None
            self.bound_view_proxy = None
            return

        proxy = SearchCardProxyModel(view)
        proxy.setSourceModel(source_model)
        view.setModel(proxy)

        self.bound_view_source_model = source_model
        self.bound_view_proxy = proxy
        self.clear_table_search_state()

    def clear_table_search_state(self) -> None:
        """清理搜索状态：取消筛选、清空匹配。"""

        self.bound_view_matches = []
        self.bound_view_current_match_index = -1

        proxy = self.bound_view_proxy
        if proxy is not None:
            proxy.set_search(
                "",
                columns=self.bound_view_columns,
                regex_mode=self.regex_mode,
            )

        return

    def apply_table_search(self) -> None:
        """根据当前 keyword/regex 状态应用搜索（用于选项切换/回车触发）。"""

        self.run_table_search(reverse=False)

    def run_table_search(self, reverse: bool) -> None:
        """执行一次“查找上一个/下一个”。

        兼容历史 API：当前实现仅支持 Model/View 绑定路径。
        """

        if self.bound_view is None or self.bound_view_proxy is None:
            return
        self.run_view_search(reverse)

    def run_view_search(self, reverse: bool) -> None:
        view = self.bound_view
        proxy = self.bound_view_proxy
        if view is None or proxy is None:
            return

        keyword = self.get_keyword()
        if not keyword:
            self.clear_match_info()
            self.clear_table_search_state()
            return

        if self.regex_mode:
            is_valid, error_msg = self.validate_regex()
            if not is_valid:
                if callable(self.bound_view_notify):
                    self.bound_view_notify(
                        "error",
                        f"{Localizer.get().search_regex_invalid}: {error_msg}",
                    )
                return

        proxy.set_search(
            keyword,
            columns=self.bound_view_columns,
            regex_mode=self.regex_mode,
        )

        matches = self.build_model_matches(
            model=proxy,
            keyword=keyword,
            use_regex=self.regex_mode,
            columns=self.bound_view_columns,
        )

        if not matches:
            self.set_match_info(0, 0)
            if callable(self.bound_view_notify):
                self.bound_view_notify("warning", Localizer.get().search_no_match)
            return

        current_row = self.get_view_current_row(view)
        target_row = self.pick_next_match(matches, current_row, reverse)
        self.update_view_match_selection(view, matches, target_row)

    @staticmethod
    def pick_next_match(matches: list[int], current_row: int, reverse: bool) -> int:
        if not matches:
            return -1

        if reverse:
            prev_matches = [m for m in matches if m < current_row]
            if prev_matches:
                return prev_matches[-1]
            return matches[-1]

        next_matches = [m for m in matches if m > current_row]
        if next_matches:
            return next_matches[0]
        return matches[0]

    @staticmethod
    def build_model_matches(
        *,
        model: QAbstractItemModel,
        keyword: str,
        use_regex: bool,
        columns: tuple[int, ...],
    ) -> list[int]:
        matches: list[int] = []
        if not keyword:
            return matches

        if use_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                return matches
            keyword_lower = ""
        else:
            pattern = None
            keyword_lower = keyword.lower()

        row_count = model.rowCount()
        for row in range(row_count):
            texts: list[str] = []
            for col in columns:
                index = model.index(row, col)
                value = index.data(int(Qt.ItemDataRole.DisplayRole))
                text = str(value).strip() if value is not None else ""
                if text:
                    texts.append(text)

            if not texts:
                continue

            if pattern is not None:
                if any(pattern.search(text) for text in texts):
                    matches.append(row)
            else:
                if any(keyword_lower in text.lower() for text in texts):
                    matches.append(row)

        return matches

    @staticmethod
    def get_view_current_row(view: QAbstractItemView) -> int:
        index = view.currentIndex()
        if not index.isValid():
            return -1
        return int(index.row())

    def update_view_match_selection(
        self, view: QAbstractItemView, matches: list[int], target_row: int
    ) -> None:
        if target_row < 0:
            self.bound_view_matches = []
            self.bound_view_current_match_index = -1
            self.clear_match_info()
            return

        self.bound_view_matches = matches
        self.bound_view_current_match_index = matches.index(target_row)
        self.set_match_info(self.bound_view_current_match_index + 1, len(matches))

        model = view.model()
        selection_model = view.selectionModel()
        if model is None or selection_model is None:
            return

        index = model.index(target_row, 0)
        if not index.isValid():
            return

        selection_model.setCurrentIndex(
            index,
            QItemSelectionModel.SelectionFlag.ClearAndSelect,
        )
        if isinstance(view, QTableView):
            view.selectRow(target_row)
        view.scrollTo(index, QAbstractItemView.ScrollHint.PositionAtCenter)

    def validate_regex(self) -> tuple[bool, str]:
        """验证正则表达式合法性，返回 (是否有效, 错误信息)"""
        if not self.regex_mode:
            return True, ""

        pattern = self.get_keyword()
        if not pattern:
            return True, ""

        try:
            re.compile(pattern)
            return True, ""
        except re.error as e:
            return False, str(e)

    def on_prev_clicked(self, clicked: Callable) -> None:
        """注册上一个按钮点击回调，传递 self 以便外部获取上下文"""
        self.prev_btn.clicked.connect(lambda: clicked(self))

    def on_next_clicked(self, clicked: Callable) -> None:
        """注册下一个按钮点击回调，传递 self 以便外部获取上下文"""
        self.next_btn.clicked.connect(lambda: clicked(self))

    def on_back_clicked(self, clicked: Callable) -> None:
        """注册返回按钮点击回调，传递 self 以便外部获取上下文"""
        self.back.clicked.connect(lambda: clicked(self))

    def on_search_triggered(self, triggered: Callable) -> None:
        """注册搜索触发回调（回车或点击搜索图标）"""
        # searchSignal 在点击搜索按钮时触发，某些版本回车键也会触发此信号
        self.line_edit.searchSignal.connect(
            lambda text: self.emit_search_triggered(triggered)
        )
        # 显式连接 returnPressed 信号，确保回车键始终能响应搜索
        self.line_edit.returnPressed.connect(
            lambda: self.emit_search_triggered(triggered)
        )

    def emit_search_triggered(self, triggered: Callable) -> None:
        keyword = self.get_keyword()
        now = time.monotonic()
        if (
            keyword == self.search_last_trigger_keyword
            and self.regex_mode == self.search_last_trigger_regex_mode
            and now - self.search_last_trigger_time
            < self.search_trigger_debounce_seconds
        ):
            return
        self.search_last_trigger_time = now
        self.search_last_trigger_keyword = keyword
        self.search_last_trigger_regex_mode = self.regex_mode
        self.search_triggered.emit(keyword, self.regex_mode)
        triggered(self)

    def on_search_options_changed(self, changed: Callable) -> None:
        """注册搜索选项切换回调。"""
        self.search_options_changed.connect(lambda: changed(self))

    def on_replace_clicked(self, clicked: Callable) -> None:
        """注册单步替换点击回调。"""
        self.replace_btn.clicked.connect(lambda: self.emit_replace_triggered(clicked))

    def on_replace_all_clicked(self, clicked: Callable) -> None:
        """注册全部替换点击回调。"""
        self.replace_all_btn.clicked.connect(
            lambda: self.emit_replace_all_triggered(clicked)
        )

    def emit_replace_triggered(self, clicked: Callable) -> None:
        self.replace_triggered.emit()
        clicked(self)

    def emit_replace_all_triggered(self, clicked: Callable) -> None:
        self.replace_all_triggered.emit()
        clicked(self)
