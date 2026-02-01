from typing import Callable

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import PillToolButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer


# ==================== 图标常量 ====================

ICON_REGEX: BaseIcon = BaseIcon.REGEX  # 规则按钮：正则
ICON_CASE_SENSITIVE: BaseIcon = BaseIcon.CASE_SENSITIVE  # 规则按钮：大小写敏感


class RuleWidget(QWidget):
    """规则切换按钮组件，包含正则和大小写敏感两个切换按钮"""

    def __init__(
        self,
        parent: QWidget = None,
        show_regex: bool = True,
        show_case_sensitive: bool = True,
        regex_enabled: bool = False,
        case_sensitive_enabled: bool = False,
        on_changed: Callable[[bool, bool], None] = None,
    ) -> None:
        """
        初始化规则组件

        参数:
            parent: 父控件
            show_regex: 是否显示正则按钮
            show_case_sensitive: 是否显示大小写敏感按钮
            regex_enabled: 正则初始状态
            case_sensitive_enabled: 大小写敏感初始状态
            on_changed: 状态改变回调函数 (regex, case_sensitive)
        """
        super().__init__(parent)

        self.on_changed_callback = on_changed

        # 设置布局
        self.layout = QHBoxLayout(self)
        self.layout.setContentsMargins(4, 4, 4, 4)
        self.layout.setSpacing(4)
        self.layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # 初始化按钮为 None
        self.regex_button: PillToolButton | None = None
        self.case_button: PillToolButton | None = None

        # 创建正则按钮
        if show_regex:
            self.regex_button = PillToolButton(ICON_REGEX, self)
            self.regex_button.setIconSize(QSize(14, 14))
            self.regex_button.setFixedSize(28, 28)
            self.regex_button.setChecked(regex_enabled)
            self.regex_button.toggled.connect(self.on_regex_toggled)
            self.layout.addWidget(self.regex_button)
            # 安装 ToolTipFilter
            self.regex_button.installEventFilter(
                ToolTipFilter(self.regex_button, 300, ToolTipPosition.TOP)
            )
            self.update_regex_tooltip()

        # 创建大小写敏感按钮
        if show_case_sensitive:
            self.case_button = PillToolButton(ICON_CASE_SENSITIVE, self)
            self.case_button.setIconSize(QSize(16, 16))
            self.case_button.setFixedSize(28, 28)
            self.case_button.setChecked(case_sensitive_enabled)
            self.case_button.toggled.connect(self.on_case_toggled)
            self.layout.addWidget(self.case_button)
            # 安装 ToolTipFilter
            self.case_button.installEventFilter(
                ToolTipFilter(self.case_button, 300, ToolTipPosition.TOP)
            )
            self.update_case_tooltip()

    def on_regex_toggled(self, checked: bool) -> None:
        """正则按钮切换事件"""
        self.update_regex_tooltip()
        self.trigger_callback()

    def on_case_toggled(self, checked: bool) -> None:
        """大小写敏感按钮切换事件"""
        self.update_case_tooltip()
        self.trigger_callback()

    def update_regex_tooltip(self) -> None:
        """更新正则按钮 tooltip"""
        if self.regex_button is None:
            return
        tooltip_text = (
            f"{Localizer.get().rule_regex}\n{Localizer.get().status_enabled}"
            if self.regex_button.isChecked()
            else f"{Localizer.get().rule_regex}\n{Localizer.get().status_disabled}"
        )
        self.regex_button.setToolTip(tooltip_text)

    def update_case_tooltip(self) -> None:
        """更新大小写敏感按钮 tooltip"""
        if self.case_button is None:
            return
        tooltip_text = (
            f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().status_enabled}"
            if self.case_button.isChecked()
            else f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().status_disabled}"
        )
        self.case_button.setToolTip(tooltip_text)

    def trigger_callback(self) -> None:
        """触发状态改变回调"""
        if callable(self.on_changed_callback):
            self.on_changed_callback(
                self.get_regex_enabled(), self.get_case_sensitive_enabled()
            )

    def get_regex_enabled(self) -> bool:
        """获取正则状态"""
        if self.regex_button is None:
            return False
        return self.regex_button.isChecked()

    def get_case_sensitive_enabled(self) -> bool:
        """获取大小写敏感状态"""
        if self.case_button is None:
            return False
        return self.case_button.isChecked()

    def set_regex_enabled(self, enabled: bool) -> None:
        """设置正则状态"""
        if self.regex_button is not None:
            self.regex_button.setChecked(enabled)

    def set_case_sensitive_enabled(self, enabled: bool) -> None:
        """设置大小写敏感状态"""
        if self.case_button is not None:
            self.case_button.setChecked(enabled)
