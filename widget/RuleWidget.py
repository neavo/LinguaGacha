from typing import Callable

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QIcon
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPixmap
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import ToolButton

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
        from qfluentwidgets import qconfig
        qconfig.themeChanged.connect(self._on_theme_changed)

    def _on_theme_changed(self, theme):
        """主题变化时更新样式"""
        self._update_all_styles()

    def _update_all_styles(self):
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

    def _create_colored_icon(self, icon: FluentIcon, color: QColor) -> QIcon:
        """创建指定颜色的图标"""
        # 使用更大的尺寸以确保清晰度，特别是在高DPI屏幕上
        icon_size = 24  # 从16增加到24，按钮是28x28，留一些边距

        # 获取原始图标，使用更大的尺寸
        original_icon = icon.icon()
        pixmap = original_icon.pixmap(icon_size, icon_size)

        # 考虑设备像素比
        device_pixel_ratio = self.devicePixelRatio()
        if device_pixel_ratio > 1:
            # 为高DPI屏幕创建更高分辨率的图标
            pixmap = original_icon.pixmap(int(icon_size * device_pixel_ratio), int(icon_size * device_pixel_ratio))
            pixmap.setDevicePixelRatio(device_pixel_ratio)

        # 创建一个新的 pixmap 用于重新着色
        colored_pixmap = QPixmap(pixmap.size())
        colored_pixmap.fill(Qt.GlobalColor.transparent)
        if device_pixel_ratio > 1:
            colored_pixmap.setDevicePixelRatio(device_pixel_ratio)

        # 使用 QPainter 重新着色
        painter = QPainter(colored_pixmap)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)  # 启用抗锯齿
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)  # 平滑变换
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_Source)
        painter.drawPixmap(0, 0, pixmap)
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
        painter.fillRect(colored_pixmap.rect(), color)
        painter.end()

        return QIcon(colored_pixmap)

    def _update_regex_style(self) -> None:
        """更新正则按钮样式和tooltip"""
        if self.regex_button is None:
            return

        from qfluentwidgets import Theme
        from qfluentwidgets import ToolTipFilter
        from qfluentwidgets import ToolTipPosition
        from qfluentwidgets import qconfig

        from module.Localizer.Localizer import Localizer

        # 直接从 qconfig 获取当前主题，确保是最新的
        is_dark = qconfig.theme == Theme.DARK

        # 根据主题和状态决定颜色
        if self.regex_enabled:
            # 激活状态：绿底白图标
            bg_color = "#2ECC71"
            border_color = "#27AE60"
            hover_color = "#27AE60"
            pressed_color = "#229954"
            icon_color = QColor(255, 255, 255)  # 白色图标
        else:
            # 未激活状态：根据主题选择灰色
            if is_dark:
                bg_color = "#3A3A3A"
                border_color = "#4A4A4A"
                hover_color = "#4A4A4A"
                pressed_color = "#5A5A5A"
                icon_color = QColor(200, 200, 200)  # 浅灰色图标
            else:
                bg_color = "#E0E0E0"
                border_color = "#BDBDBD"
                hover_color = "#D0D0D0"
                pressed_color = "#C0C0C0"
                icon_color = QColor(80, 80, 80)  # 深灰色图标

        # 设置图标
        self.regex_button.setIcon(self._create_colored_icon(FluentIcon.IOT, icon_color))

        # 设置对象名称以提高样式优先级
        self.regex_button.setObjectName("RuleButton")

        # 使用对象名称选择器设置样式（优先级更高）
        self.regex_button.setStyleSheet(
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

        # 额外设置 QPalette 作为备用方案
        from PyQt5.QtGui import QBrush
        from PyQt5.QtGui import QPalette
        palette = self.regex_button.palette()
        palette.setColor(QPalette.ColorRole.Button, QColor(bg_color))
        self.regex_button.setPalette(palette)
        self.regex_button.setAutoFillBackground(True)

        # 设置 tooltip（避免重复添加 EventFilter）
        if self.regex_enabled:
            tooltip_text = f"{Localizer.get().rule_regex}\n{Localizer.get().rule_regex_on}"
        else:
            tooltip_text = f"{Localizer.get().rule_regex}\n{Localizer.get().rule_regex_off}"

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

        from qfluentwidgets import Theme
        from qfluentwidgets import ToolTipFilter
        from qfluentwidgets import ToolTipPosition
        from qfluentwidgets import qconfig

        from module.Localizer.Localizer import Localizer

        # 直接从 qconfig 获取当前主题，确保是最新的
        is_dark = qconfig.theme == Theme.DARK

        # 根据主题和状态决定颜色
        if self.case_sensitive_enabled:
            # 激活状态：绿底白图标
            bg_color = "#2ECC71"
            border_color = "#27AE60"
            hover_color = "#27AE60"
            pressed_color = "#229954"
            icon_color = QColor(255, 255, 255)  # 白色图标
        else:
            # 未激活状态：根据主题选择灰色
            if is_dark:
                bg_color = "#3A3A3A"
                border_color = "#4A4A4A"
                hover_color = "#4A4A4A"
                pressed_color = "#5A5A5A"
                icon_color = QColor(200, 200, 200)  # 浅灰色图标
            else:
                bg_color = "#E0E0E0"
                border_color = "#BDBDBD"
                hover_color = "#D0D0D0"
                pressed_color = "#C0C0C0"
                icon_color = QColor(80, 80, 80)  # 深灰色图标

        # 设置图标
        self.case_button.setIcon(self._create_colored_icon(FluentIcon.FONT, icon_color))

        # 设置对象名称以提高样式优先级
        self.case_button.setObjectName("RuleButton")

        # 使用对象名称选择器设置样式（优先级更高）
        self.case_button.setStyleSheet(
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

        # 额外设置 QPalette 作为备用方案
        from PyQt5.QtGui import QBrush
        from PyQt5.QtGui import QPalette
        palette = self.case_button.palette()
        palette.setColor(QPalette.ColorRole.Button, QColor(bg_color))
        self.case_button.setPalette(palette)
        self.case_button.setAutoFillBackground(True)

        # 设置 tooltip（避免重复添加 EventFilter）
        if self.case_sensitive_enabled:
            tooltip_text = f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_on}"
        else:
            tooltip_text = f"{Localizer.get().rule_case_sensitive}\n{Localizer.get().rule_case_sensitive_off}"

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
