import re
import time
from typing import Callable

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QTableWidget
from PyQt5.QtWidgets import QWidget
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


class SearchCard(CardWidget):
    """搜索卡片组件，支持普通/正则搜索模式及上下跳转"""

    search_mode_changed = pyqtSignal(bool)
    search_triggered = pyqtSignal(str, bool, bool)

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

        # 可选：表格绑定模式（用于 TableWidget 类页面的通用搜索/筛选/跳转）。
        self.bound_table: QTableWidget | None = None
        self.bound_columns: tuple[int, ...] = ()
        self.bound_notify: Callable[[str, str], None] | None = None
        self.bound_matches: list[int] = []
        self.bound_current_match_index: int = -1

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

    # ==================== 可选：Table 绑定搜索 ====================

    def bind_table(
        self,
        table: QTableWidget,
        columns: tuple[int, ...],
        notify: Callable[[str, str], None] | None = None,
    ) -> None:
        """绑定一个 QTableWidget 并启用内置搜索/筛选逻辑。

        notify(level, message): level 建议为 'error'/'warning'/'info'。
        """

        self.bound_table = table
        self.bound_columns = columns
        self.bound_notify = notify
        self.clear_table_search_state()

    def clear_table_search_state(self) -> None:
        """清理表格搜索状态：取消筛选、清空匹配。"""

        self.bound_matches = []
        self.bound_current_match_index = -1

        table = self.bound_table
        if table is None:
            return

        try:
            table.setUpdatesEnabled(False)
            for row in range(table.rowCount()):
                table.setRowHidden(row, False)
        except RuntimeError:
            # 绑定的表格可能已被 Qt 销毁（例如页面销毁时），此时静默跳过。
            return
        finally:
            try:
                table.setUpdatesEnabled(True)
            except RuntimeError:
                pass

    def apply_table_search(self) -> None:
        """根据当前 keyword/filter/regex 状态应用搜索（用于模式切换/回车触发）。"""

        self.run_table_search(reverse=False)

    def run_table_search(self, reverse: bool) -> None:
        """执行一次“查找上一个/下一个”。

        - filter_mode 开启时：隐藏不匹配行与空白行
        - regex_mode 开启时：正则非法会触发 notify('error', ...)
        """

        table = self.bound_table
        if table is None:
            return

        keyword = self.get_keyword()
        if not keyword:
            self.clear_match_info()
            self.clear_table_search_state()
            return

        if self.regex_mode:
            is_valid, error_msg = self.validate_regex()
            if not is_valid:
                if callable(self.bound_notify):
                    self.bound_notify(
                        "error",
                        f"{Localizer.get().search_regex_invalid}: {error_msg}",
                    )
                return

        matches, empty_rows = self.build_table_matches(
            table=table,
            keyword=keyword,
            use_regex=self.regex_mode,
            columns=self.bound_columns,
        )

        if self.filter_mode:
            self.apply_table_row_filter(table, matches, empty_rows, keyword)
        else:
            self.clear_table_row_filter(table)

        if not matches:
            self.set_match_info(0, 0)
            if callable(self.bound_notify):
                self.bound_notify("warning", Localizer.get().search_no_match)
            return

        target_row = self.pick_next_match(matches, table.currentRow(), reverse)
        self.update_table_match_selection(table, matches, target_row)

    @staticmethod
    def build_table_matches(
        table: QTableWidget,
        keyword: str,
        use_regex: bool,
        columns: tuple[int, ...],
    ) -> tuple[list[int], set[int]]:
        """扫描表格内容，返回 (match_rows, empty_rows)。"""

        matches: list[int] = []
        empty_rows: set[int] = set()

        if use_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                return [], set()
            keyword_lower = ""
        else:
            pattern = None
            keyword_lower = keyword.lower()

        for row in range(table.rowCount()):
            texts: list[str] = []
            for col in columns:
                item = table.item(row, col)
                if not item:
                    continue
                text = item.text().strip()
                if text:
                    texts.append(text)

            if not texts:
                empty_rows.add(row)
                continue

            if not keyword:
                continue

            if pattern:
                if any(pattern.search(text) for text in texts):
                    matches.append(row)
            else:
                if any(keyword_lower in text.lower() for text in texts):
                    matches.append(row)

        return matches, empty_rows

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

    def apply_table_row_filter(
        self,
        table: QTableWidget,
        matches: list[int],
        empty_rows: set[int],
        keyword: str,
    ) -> None:
        table.setUpdatesEnabled(False)
        match_set = set(matches)
        for row in range(table.rowCount()):
            if not keyword:
                table.setRowHidden(row, False)
                continue
            if row in empty_rows:
                table.setRowHidden(row, True)
                continue
            table.setRowHidden(row, row not in match_set)
        table.setUpdatesEnabled(True)

    def clear_table_row_filter(self, table: QTableWidget) -> None:
        table.setUpdatesEnabled(False)
        for row in range(table.rowCount()):
            table.setRowHidden(row, False)
        table.setUpdatesEnabled(True)

    def update_table_match_selection(
        self, table: QTableWidget, matches: list[int], target_row: int
    ) -> None:
        if target_row < 0:
            self.bound_matches = []
            self.bound_current_match_index = -1
            self.clear_match_info()
            return

        self.bound_matches = matches
        self.bound_current_match_index = matches.index(target_row)
        self.set_match_info(self.bound_current_match_index + 1, len(matches))
        table.setCurrentCell(target_row, 0)
        item = table.item(target_row, 0)
        if item:
            table.scrollToItem(item)

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
