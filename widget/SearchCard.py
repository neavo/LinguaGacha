import re
from typing import Callable

from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import LineEdit
from qfluentwidgets import ToggleToolButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentPushButton

from module.Localizer.Localizer import Localizer

class SearchCard(CardWidget):
    """搜索卡片组件，支持普通/正则搜索模式及上下跳转"""

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)

        # 搜索模式：False=普通搜索，True=正则搜索
        self._regex_mode: bool = False

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 搜索输入框
        self.line_edit = LineEdit()
        self.line_edit.setFixedWidth(256)
        self.line_edit.setPlaceholderText(Localizer.get().placeholder)
        self.line_edit.setClearButtonEnabled(True)
        self.root.addWidget(self.line_edit)

        # 正则模式切换按钮
        self.regex_toggle = ToggleToolButton(FluentIcon.CODE, self)
        self.regex_toggle.setChecked(False)
        self.regex_toggle.clicked.connect(self._on_regex_toggle)
        self.regex_toggle.installEventFilter(ToolTipFilter(self.regex_toggle, 500, ToolTipPosition.TOP))
        self._update_regex_tooltip()
        self.root.addWidget(self.regex_toggle)

        # 匹配计数标签（如 "3 / 15"）
        self.match_label = CaptionLabel("", self)
        self.match_label.setMinimumWidth(64)
        self.root.addWidget(self.match_label)

        # 上一个按钮
        self.prev = TransparentPushButton(self)
        self.prev.setIcon(FluentIcon.UP)
        self.prev.setText(Localizer.get().search_prev)
        self.root.addWidget(self.prev)

        # 下一个按钮
        self.next = TransparentPushButton(self)
        self.next.setIcon(FluentIcon.DOWN)
        self.next.setText(Localizer.get().search_next)
        self.root.addWidget(self.next)

        # 填充
        self.root.addStretch(1)

        # 返回按钮
        self.back = TransparentPushButton(self)
        self.back.setIcon(FluentIcon.EMBED)
        self.back.setText(Localizer.get().back)
        self.root.addWidget(self.back)

    def _on_regex_toggle(self) -> None:
        """正则模式切换"""
        self._regex_mode = self.regex_toggle.isChecked()
        self._update_regex_tooltip()

    def _update_regex_tooltip(self) -> None:
        """更新正则按钮的提示文本"""
        if self._regex_mode:
            self.regex_toggle.setToolTip(Localizer.get().search_regex_on)
        else:
            self.regex_toggle.setToolTip(Localizer.get().search_regex_off)

    def is_regex_mode(self) -> bool:
        """获取当前是否为正则搜索模式"""
        return self._regex_mode

    def get_line_edit(self) -> LineEdit:
        """获取搜索输入框"""
        return self.line_edit

    def get_keyword(self) -> str:
        """获取当前搜索关键词"""
        return self.line_edit.text().strip()

    def set_match_info(self, current: int, total: int) -> None:
        """设置匹配信息显示（如 "3 / 15"）"""
        if total > 0:
            self.match_label.setText(f"{current} / {total}")
        else:
            self.match_label.setText("")

    def clear_match_info(self) -> None:
        """清除匹配信息"""
        self.match_label.setText("")

    def validate_regex(self) -> tuple[bool, str]:
        """验证正则表达式是否有效

        Returns:
            (is_valid, error_message)
        """
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
        """注册上一个按钮点击回调"""
        self.prev.clicked.connect(lambda: clicked(self))

    def on_next_clicked(self, clicked: Callable) -> None:
        """注册下一个按钮点击回调"""
        self.next.clicked.connect(lambda: clicked(self))

    def on_back_clicked(self, clicked: Callable) -> None:
        """注册返回按钮点击回调"""
        self.back.clicked.connect(lambda: clicked(self))

    def on_search_triggered(self, triggered: Callable) -> None:
        """注册搜索触发回调（回车键）"""
        self.line_edit.returnPressed.connect(lambda: triggered(self))