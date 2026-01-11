from typing import Callable
from typing import Optional

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import Theme
from qfluentwidgets import ToolButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import qconfig

from module.Localizer.Localizer import Localizer

class RuleWidget(QWidget):
    """规则切换按钮组件，包含正则和大小写敏感两个切换按钮"""

    # 颜色常量：激活状态 - 亮色主题（主题色 #BCA483）
    COLOR_ACTIVE_LIGHT_BG = "#BCA483"
    COLOR_ACTIVE_LIGHT_BORDER = "#BCA483"
    COLOR_ACTIVE_LIGHT_HOVER = "#A99171"
    COLOR_ACTIVE_LIGHT_PRESSED = "#968060"

    # 颜色常量：激活状态 - 暗色主题（主题色 #BCA483 提亮，增强深色背景对比）
    COLOR_ACTIVE_DARK_BG = "#DCCAB1"
    COLOR_ACTIVE_DARK_BORDER = "#DCCAB1"
    COLOR_ACTIVE_DARK_HOVER = "#CBB89E"
    COLOR_ACTIVE_DARK_PRESSED = "#BAA68B"

    # 颜色常量：未激活深色主题（深灰系）
    COLOR_INACTIVE_DARK_BG = "#3A3A3A"
    COLOR_INACTIVE_DARK_BORDER = "#4A4A4A"
    COLOR_INACTIVE_DARK_HOVER = "#4A4A4A"
    COLOR_INACTIVE_DARK_PRESSED = "#5A5A5A"

    # 颜色常量：未激活浅色主题（浅灰系）
    COLOR_INACTIVE_LIGHT_BG = "#E0E0E0"
    COLOR_INACTIVE_LIGHT_BORDER = "#BDBDBD"
    COLOR_INACTIVE_LIGHT_HOVER = "#D0D0D0"
    COLOR_INACTIVE_LIGHT_PRESSED = "#C0C0C0"

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

        # 初始化状态
        self.regex_enabled = regex_enabled
        self.case_sensitive_enabled = case_sensitive_enabled
        self.on_changed_callback = on_changed

        # 设置布局
        self.layout = QHBoxLayout(self)
        self.layout.setContentsMargins(4, 4, 4, 4)
        self.layout.setSpacing(4)
        self.layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # 初始化按钮为 None
        self.regex_button = None
        self.case_button = None

        # EventFilter 引用（避免重复添加）
        self.regex_tooltip_filter = None
        self.case_tooltip_filter = None

        # 创建正则按钮
        if show_regex:
            self.regex_button = ToolButton(self)
            self.regex_button.setFixedSize(28, 28)
            self.regex_button.clicked.connect(self._on_regex_clicked)
            self.layout.addWidget(self.regex_button)

        # 创建大小写敏感按钮
        if show_case_sensitive:
            self.case_button = ToolButton(self)
            self.case_button.setFixedSize(28, 28)
            self.case_button.clicked.connect(self._on_case_clicked)
            self.layout.addWidget(self.case_button)

        # 初始化样式
        self._update_all_styles()

        # 监听主题变化
        qconfig.themeChanged.connect(self._on_theme_changed)

        # 确保销毁时断开信号，避免悬空连接
        self.destroyed.connect(self._disconnect_theme_signal)

    def _disconnect_theme_signal(self) -> None:
        """断开主题变化信号连接，防止悬空引用"""
        try:
            qconfig.themeChanged.disconnect(self._on_theme_changed)
        except (TypeError, RuntimeError):
            # 信号可能已经断开或对象已销毁，忽略错误
            pass

    def _on_theme_changed(self, theme: Theme) -> None:
        """主题变化时更新样式"""
        # 使用延迟调用确保主题完全切换后再更新，避免竞态条件
        QTimer.singleShot(0, self._update_all_styles)

    def _update_all_styles(self) -> None:
        """更新所有按钮样式"""
        if self.regex_button is not None:
            self._update_regex_style()
        if self.case_button is not None:
            self._update_case_style()

    def _on_regex_clicked(self) -> None:
        """正则按钮点击事件"""
        self.regex_enabled = not self.regex_enabled
        self._update_regex_style()
        self._trigger_callback()

    def _on_case_clicked(self) -> None:
        """大小写敏感按钮点击事件"""
        self.case_sensitive_enabled = not self.case_sensitive_enabled
        self._update_case_style()
        self._trigger_callback()

    def _get_style_colors(self, is_active: bool) -> tuple[str, str, str, str, Optional[QColor]]:
        """
        根据激活状态和当前主题获取样式颜色

        返回: (bg_color, border_color, hover_color, pressed_color, icon_color)
        """
        is_dark = qconfig.theme == Theme.DARK

        if is_active:
            if is_dark:
                return (
                    self.COLOR_ACTIVE_DARK_BG,
                    self.COLOR_ACTIVE_DARK_BORDER,
                    self.COLOR_ACTIVE_DARK_HOVER,
                    self.COLOR_ACTIVE_DARK_PRESSED,
                    QColor(255, 255, 255),  # 激活状态始终保持白色图标
                )
            else:
                return (
                    self.COLOR_ACTIVE_LIGHT_BG,
                    self.COLOR_ACTIVE_LIGHT_BORDER,
                    self.COLOR_ACTIVE_LIGHT_HOVER,
                    self.COLOR_ACTIVE_LIGHT_PRESSED,
                    QColor(255, 255, 255),
                )

        # 非激活状态
        if is_dark:
            return (
                self.COLOR_INACTIVE_DARK_BG,
                self.COLOR_INACTIVE_DARK_BORDER,
                self.COLOR_INACTIVE_DARK_HOVER,
                self.COLOR_INACTIVE_DARK_PRESSED,
                None,  # 使用默认主题图标颜色
            )

        return (
            self.COLOR_INACTIVE_LIGHT_BG,
            self.COLOR_INACTIVE_LIGHT_BORDER,
            self.COLOR_INACTIVE_LIGHT_HOVER,
            self.COLOR_INACTIVE_LIGHT_PRESSED,
            None,  # 使用默认主题图标颜色
        )

    def _apply_button_style(
        self,
        button: ToolButton,
        icon: FluentIcon,
        bg_color: str,
        border_color: str,
        hover_color: str,
        pressed_color: str,
        icon_color: Optional[QColor],
    ) -> None:
        """应用按钮样式（图标、背景、边框等）"""
        # 如果指定了 icon_color 则使用，否则使用 FluentIcon 默认行为（自动适应主题）
        if icon_color:
            button.setIcon(icon.icon(icon_color))
        else:
            button.setIcon(icon.icon())

        button.setObjectName("RuleButton")
        button.setStyleSheet(
            f"""
            QToolButton#RuleButton {{
                background-color: {bg_color};
                border: 1px solid {border_color};
                border-radius: 4px;
            }}
            QToolButton#RuleButton:hover {{
                background-color: {hover_color};
            }}
            QToolButton#RuleButton:pressed {{
                background-color: {pressed_color};
            }}
            """
        )

    def _update_regex_style(self) -> None:
        """更新正则按钮样式和tooltip"""
        if self.regex_button is None:
            return

        bg_color, border_color, hover_color, pressed_color, icon_color = self._get_style_colors(self.regex_enabled)
        self._apply_button_style(
            self.regex_button, FluentIcon.IOT, bg_color, border_color, hover_color, pressed_color, icon_color
        )

        # 设置 tooltip
        tooltip_text = (
            f"{Localizer.get().rule_regex}\n{Localizer.get().rule_regex_on}"
            if self.regex_enabled
            else f"{Localizer.get().rule_regex}\n{Localizer.get().rule_regex_off}"
        )
        self.regex_button.setToolTip(tooltip_text)

        # 移除旧的 EventFilter 并添加新的
        if self.regex_tooltip_filter is not None:
            self.regex_button.removeEventFilter(self.regex_tooltip_filter)
        self.regex_tooltip_filter = ToolTipFilter(self.regex_button, 300, ToolTipPosition.TOP)
        self.regex_button.installEventFilter(self.regex_tooltip_filter)

    def _update_case_style(self) -> None:
        """更新大小写敏感按钮样式和tooltip"""
        if self.case_button is None:
            return

        bg_color, border_color, hover_color, pressed_color, icon_color = self._get_style_colors(
            self.case_sensitive_enabled
        )
        self._apply_button_style(
            self.case_button, FluentIcon.FONT, bg_color, border_color, hover_color, pressed_color, icon_color
        )

        # 设置 tooltip
        tooltip_text = (
            f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_on}"
            if self.case_sensitive_enabled
            else f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_off}"
        )
        self.case_button.setToolTip(tooltip_text)

        # 移除旧的 EventFilter 并添加新的
        if self.case_tooltip_filter is not None:
            self.case_button.removeEventFilter(self.case_tooltip_filter)
        self.case_tooltip_filter = ToolTipFilter(self.case_button, 300, ToolTipPosition.TOP)
        self.case_button.installEventFilter(self.case_tooltip_filter)

    def _trigger_callback(self) -> None:
        """触发状态改变回调"""
        if callable(self.on_changed_callback):
            self.on_changed_callback(self.regex_enabled, self.case_sensitive_enabled)

    def get_regex_enabled(self) -> bool:
        """获取正则状态"""
        return self.regex_enabled

    def get_case_sensitive_enabled(self) -> bool:
        """获取大小写敏感状态"""
        return self.case_sensitive_enabled

    def set_regex_enabled(self, enabled: bool) -> None:
        """设置正则状态"""
        if self.regex_enabled != enabled:
            self.regex_enabled = enabled
            self._update_regex_style()

    def set_case_sensitive_enabled(self, enabled: bool) -> None:
        """设置大小写敏感状态"""
        if self.case_sensitive_enabled != enabled:
            self.case_sensitive_enabled = enabled
            self._update_case_style()
