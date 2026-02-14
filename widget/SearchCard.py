import re
import time
from typing import Callable

from PySide6.QtCore import QAbstractItemModel
from PySide6.QtCore import QItemSelectionModel
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QSortFilterProxyModel
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import PillPushButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import TransparentToolButton
from qfluentwidgets import VerticalSeparator

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomSearchLineEdit


# ==================== 图标常量 ====================

ICON_BACK: BaseIcon = BaseIcon.CIRCLE_ARROW_LEFT  # 搜索栏：返回
ICON_PREV_MATCH: BaseIcon = BaseIcon.CIRCLE_CHEVRON_UP  # 搜索栏：上一个匹配
ICON_NEXT_MATCH: BaseIcon = BaseIcon.CIRCLE_CHEVRON_DOWN  # 搜索栏：下一个匹配


class SearchCardProxyModel(QSortFilterProxyModel):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.keyword: str = ""
        self.regex_mode: bool = False
        self.filter_mode: bool = False
        self.columns: tuple[int, ...] = ()
        self.keyword_lower: str = ""
        self.pattern: re.Pattern[str] | None = None

    def set_search(
        self,
        keyword: str,
        *,
        columns: tuple[int, ...],
        regex_mode: bool,
        filter_mode: bool,
    ) -> None:
        self.keyword = keyword
        self.regex_mode = bool(regex_mode)
        self.filter_mode = bool(filter_mode)
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
        source_parent: QModelIndex,
    ) -> bool:  # noqa: N802
        del source_parent

        if not self.filter_mode:
            return True

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

    search_mode_changed = Signal(bool)
    search_triggered = Signal(str, bool, bool)

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)

        # 搜索模式：False=普通搜索，True=正则搜索
        self.regex_mode: bool = False
        self.filter_mode: bool = False
        self.search_last_trigger_time: float = 0.0
        self.search_last_trigger_keyword: str = ""
        self.search_last_trigger_filter_mode: bool = False
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
        self.root.setSpacing(12)

        # 1. 返回按钮
        self.back = TransparentPushButton(self)
        self.back.setIcon(ICON_BACK)
        self.back.setText(Localizer.get().back)
        self.root.addWidget(self.back)

        self.root.addWidget(VerticalSeparator())

        # 2. 筛选模式切换按钮
        self.filter_btn = PillPushButton(Localizer.get().filter, self)
        self.filter_btn.setCheckable(True)
        self.filter_btn.clicked.connect(self.on_filter_toggle)
        self.filter_btn.installEventFilter(
            ToolTipFilter(self.filter_btn, 300, ToolTipPosition.TOP)
        )
        self.update_filter_tooltip()
        self.root.addWidget(self.filter_btn)

        # 3. 正则模式切换按钮
        self.regex_btn = PillPushButton(Localizer.get().search_regex_btn, self)
        self.regex_btn.setCheckable(True)
        self.regex_btn.clicked.connect(self.on_regex_toggle)
        # 启用 ToolTip 显示，延时 300ms 触发
        self.regex_btn.installEventFilter(
            ToolTipFilter(self.regex_btn, 300, ToolTipPosition.TOP)
        )
        self.update_regex_tooltip()
        self.root.addWidget(self.regex_btn)

        self.root.addWidget(VerticalSeparator())

        # 4. 搜索输入框
        self.line_edit = CustomSearchLineEdit(self)
        self.line_edit.setMinimumWidth(256)
        self.line_edit.setPlaceholderText(Localizer.get().placeholder)
        self.line_edit.setClearButtonEnabled(True)
        self.root.addWidget(self.line_edit, 1)  # 让输入框自动拉伸占满空间

        self.root.addWidget(VerticalSeparator())

        # 5. 导航按钮
        self.prev = TransparentToolButton(self)
        self.prev.setIcon(ICON_PREV_MATCH)
        self.prev.setToolTip(Localizer.get().search_prev_match)
        self.prev.installEventFilter(ToolTipFilter(self.prev, 300, ToolTipPosition.TOP))
        self.root.addWidget(self.prev)

        self.next = TransparentToolButton(self)
        self.next.setIcon(ICON_NEXT_MATCH)
        self.next.setToolTip(Localizer.get().search_next_match)
        self.next.installEventFilter(ToolTipFilter(self.next, 300, ToolTipPosition.TOP))
        self.root.addWidget(self.next)

        self.root.addWidget(VerticalSeparator())

        # 6. 匹配数量显示
        self.match_label = CaptionLabel(Localizer.get().search_no_result, self)
        self.match_label.setMinimumWidth(64)
        self.root.addWidget(self.match_label)

        self.root.addStretch(1)

        # 7. 右侧扩展区
        self.right_container = QWidget(self)
        self.right_layout = QHBoxLayout(self.right_container)
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        self.right_layout.setSpacing(8)
        self.root.addWidget(self.right_container)

    def add_right_widget(self, widget: QWidget) -> None:
        self.right_layout.addWidget(widget)

    def reset_state(self) -> None:
        """重置搜索 UI 状态。

        用于页面禁用/数据重载等场景：不保留关键字/模式/匹配信息。
        """

        self.regex_mode = False
        self.filter_mode = False
        self.filter_btn.setChecked(False)
        self.regex_btn.setChecked(False)
        self.update_filter_tooltip()
        self.update_regex_tooltip()

        self.line_edit.setText("")
        self.clear_match_info()

        # 若绑定了表格，退出搜索时应恢复表格行可见性。
        self.clear_table_search_state()

        # 重置触发去抖状态，避免“清空后立刻搜索”被误判为重复触发。
        self.search_last_trigger_time = 0.0
        self.search_last_trigger_keyword = ""
        self.search_last_trigger_filter_mode = False
        self.search_last_trigger_regex_mode = False

    def set_base_font(self, font: QFont) -> None:
        self.setFont(font)
        self.back.setFont(font)
        self.filter_btn.setFont(font)
        self.regex_btn.setFont(font)
        self.line_edit.setFont(font)
        self.prev.setFont(font)
        self.next.setFont(font)
        self.match_label.setFont(font)

    def on_regex_toggle(self) -> None:
        """正则模式切换逻辑"""
        self.regex_mode = self.regex_btn.isChecked()
        self.update_regex_tooltip()
        self.search_mode_changed.emit(self.filter_mode)

    def update_regex_tooltip(self) -> None:
        """根据当前模式更新正则按钮的 ToolTip"""
        tooltip = (
            Localizer.get().search_regex_on
            if self.regex_mode
            else Localizer.get().search_regex_off
        )
        self.regex_btn.setToolTip(tooltip)

    def on_filter_toggle(self) -> None:
        """筛选模式切换逻辑"""
        self.filter_mode = self.filter_btn.isChecked()
        self.update_filter_tooltip()
        self.search_mode_changed.emit(self.filter_mode)

    def update_filter_tooltip(self) -> None:
        """根据当前模式更新筛选按钮的 ToolTip"""
        tooltip = (
            Localizer.get().search_filter_on
            if self.filter_mode
            else Localizer.get().search_filter_off
        )
        self.filter_btn.setToolTip(tooltip)

    def is_regex_mode(self) -> bool:
        """获取当前是否为正则搜索模式"""
        return self.regex_mode

    def is_filter_mode(self) -> bool:
        """获取当前是否为筛选模式"""
        return self.filter_mode

    def get_line_edit(self) -> CustomSearchLineEdit:
        """获取搜索输入框实例"""
        return self.line_edit

    def get_keyword(self) -> str:
        """获取当前搜索关键词，自动去除首尾空格"""
        return self.line_edit.text().strip()

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
                filter_mode=False,
            )

        return

    def apply_table_search(self) -> None:
        """根据当前 keyword/filter/regex 状态应用搜索（用于模式切换/回车触发）。"""

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
            filter_mode=self.filter_mode,
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
        self.prev.clicked.connect(lambda: clicked(self))

    def on_next_clicked(self, clicked: Callable) -> None:
        """注册下一个按钮点击回调，传递 self 以便外部获取上下文"""
        self.next.clicked.connect(lambda: clicked(self))

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
            and self.filter_mode == self.search_last_trigger_filter_mode
            and self.regex_mode == self.search_last_trigger_regex_mode
            and now - self.search_last_trigger_time
            < self.search_trigger_debounce_seconds
        ):
            return
        self.search_last_trigger_time = now
        self.search_last_trigger_keyword = keyword
        self.search_last_trigger_filter_mode = self.filter_mode
        self.search_last_trigger_regex_mode = self.regex_mode
        self.search_triggered.emit(keyword, self.filter_mode, self.regex_mode)
        triggered(self)

    def on_search_mode_changed(self, changed: Callable) -> None:
        """注册筛选模式切换回调"""
        self.search_mode_changed.connect(lambda value: changed(self))
