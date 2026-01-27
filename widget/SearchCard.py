import re
import time
from typing import Callable

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import PillPushButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import TransparentToolButton
from qfluentwidgets import VerticalSeparator

from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomSearchLineEdit


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

        # 设置容器布局
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(
            16, 16, 16, 16
        )  # 与 CommandBarCard 保持一致，确保视觉统一
        self.root.setSpacing(12)

        # 1. 返回按钮
        self.back = TransparentPushButton(self)
        self.back.setIcon(FluentIcon.EMBED)
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
        self.prev.setIcon(FluentIcon.UP)
        self.prev.setToolTip(Localizer.get().search_prev_match)
        self.prev.installEventFilter(ToolTipFilter(self.prev, 300, ToolTipPosition.TOP))
        self.root.addWidget(self.prev)

        self.next = TransparentToolButton(self)
        self.next.setIcon(FluentIcon.DOWN)
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
