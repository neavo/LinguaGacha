import re
from typing import Callable

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

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)

        # 搜索模式：False=普通搜索，True=正则搜索
        self._regex_mode: bool = False

        # 设置容器布局
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16)  # 与 CommandBarCard 保持一致，确保视觉统一
        self.root.setSpacing(12)

        # 1. 正则模式切换按钮
        self.regex_btn = PillPushButton(Localizer.get().search_regex_btn, self)
        self.regex_btn.setCheckable(True)
        self.regex_btn.clicked.connect(self._on_regex_toggle)
        # 启用 ToolTip 显示，延时 300ms 触发
        self.regex_btn.installEventFilter(ToolTipFilter(self.regex_btn, 300, ToolTipPosition.TOP))
        self._update_regex_tooltip()
        self.root.addWidget(self.regex_btn)

        self.root.addWidget(VerticalSeparator())

        # 2. 搜索输入框
        self.line_edit = CustomSearchLineEdit(self)
        self.line_edit.setMinimumWidth(256)
        self.line_edit.setPlaceholderText(Localizer.get().placeholder)
        self.line_edit.setClearButtonEnabled(True)
        self.root.addWidget(self.line_edit, 1) # 让输入框自动拉伸占满空间

        self.root.addWidget(VerticalSeparator())

        # 3. 导航按钮
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

        # 4. 匹配数量显示
        self.match_label = CaptionLabel(Localizer.get().search_no_result, self)
        self.match_label.setMinimumWidth(64)
        self.root.addWidget(self.match_label)

        self.root.addStretch(1)

        # 5. 返回按钮
        self.back = TransparentPushButton(self)
        self.back.setIcon(FluentIcon.EMBED)
        self.back.setText(Localizer.get().back)
        self.root.addWidget(self.back)

    def _on_regex_toggle(self) -> None:
        """正则模式切换逻辑"""
        self._regex_mode = self.regex_btn.isChecked()
        self._update_regex_tooltip()

    def _update_regex_tooltip(self) -> None:
        """根据当前模式更新正则按钮的 ToolTip"""
        tooltip = Localizer.get().search_regex_on if self._regex_mode else Localizer.get().search_regex_off
        self.regex_btn.setToolTip(tooltip)

    def is_regex_mode(self) -> bool:
        """获取当前是否为正则搜索模式"""
        return self._regex_mode

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
            self.match_label.setText(Localizer.get().search_match_info.format(current=current, total=total))
        else:
            self.match_label.setText(Localizer.get().search_no_result)

    def clear_match_info(self) -> None:
        """重置匹配信息为默认状态"""
        self.match_label.setText(Localizer.get().search_no_result)

    def validate_regex(self) -> tuple[bool, str]:
        """验证正则表达式合法性，返回 (是否有效, 错误信息)"""
        if not self._regex_mode:
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
        self.line_edit.searchSignal.connect(lambda text: triggered(self))
        # 显式连接 returnPressed 信号，确保回车键始终能响应搜索
        self.line_edit.returnPressed.connect(lambda: triggered(self))
