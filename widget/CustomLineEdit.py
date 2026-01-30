from qfluentwidgets import LineEdit
from qfluentwidgets import SearchLineEdit
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig
from qfluentwidgets import themeColor


class LineEditStyleMixin:
    """
    单行输入框样式混入类

    提供统一的跨平台样式和主题适配能力，供 CustomLineEdit 和 CustomSearchLineEdit 共用
    """

    # 深色主题颜色
    DARK_BG = "rgba(255, 255, 255, 0.08)"
    DARK_BG_HOVER = "rgba(255, 255, 255, 0.12)"
    DARK_TEXT = "rgba(255, 255, 255, 0.9)"
    DARK_BORDER = "rgba(255, 255, 255, 0.1)"

    # 浅色主题颜色
    LIGHT_BG = "rgba(255, 255, 255, 0.8)"
    LIGHT_BG_HOVER = "rgba(255, 255, 255, 0.95)"
    LIGHT_TEXT = "rgba(0, 0, 0, 0.9)"
    LIGHT_BORDER = "rgba(0, 0, 0, 0.1)"

    # 默认字体回落: 系统 UI → 各平台 → CJK → 通用
    FONT_DEFAULT = (
        "system-ui, "
        "'Segoe UI', "
        "'-apple-system', 'SF Pro Text', 'Helvetica Neue', "
        "'Ubuntu', 'Noto Sans', "
        "'Microsoft YaHei', 'PingFang SC', "
        "'Hiragino Sans', 'Meiryo', "
        "sans-serif"
    )

    def init_style_mixin(self, widget_class_name: str) -> None:
        """初始化样式混入，需要在子类 __init__ 中调用"""
        self._widget_class_name = widget_class_name  # 用于生成正确的 QSS 选择器

        # 初始样式
        self.update_line_edit_style()

        # 监听主题变化
        qconfig.themeChanged.connect(self.update_line_edit_style)
        self.destroyed.connect(self.disconnect_style_signals)

    def disconnect_style_signals(self) -> None:
        """断开全局信号连接，避免内存泄漏"""
        try:
            qconfig.themeChanged.disconnect(self.update_line_edit_style)
        except (TypeError, RuntimeError):
            pass

    def update_line_edit_style(self) -> None:
        """更新输入框样式"""
        is_dark = isDarkTheme()
        theme_color = themeColor().name()

        if is_dark:
            bg_color = self.DARK_BG
            bg_hover = self.DARK_BG_HOVER
            text_color = self.DARK_TEXT
            border_color = self.DARK_BORDER
        else:
            bg_color = self.LIGHT_BG
            bg_hover = self.LIGHT_BG_HOVER
            text_color = self.LIGHT_TEXT
            border_color = self.LIGHT_BORDER

        # 使用动态类名生成 QSS
        cls = self._widget_class_name

        self.setStyleSheet(f"""
            {cls} {{
                background-color: {bg_color};
                border: 1px solid {border_color};
                border-radius: 6px;
                color: {text_color};
                font-family: {self.FONT_DEFAULT};
                padding: 6px 10px;
                selection-background-color: {theme_color};
            }}
            {cls}:hover {{
                background-color: {bg_hover};
                border: 1px solid {border_color};
            }}
            {cls}:focus {{
                border: 1px solid {theme_color};
                border-bottom: 1px solid {theme_color};
                background-color: {bg_color};
            }}
        """)


class CustomLineEdit(LineEdit, LineEditStyleMixin):
    """
    自定义样式的单行输入框

    特性:
    - 自动适应深色/浅色主题
    - 跨平台字体回落
    - 统一的视觉风格
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_style_mixin("CustomLineEdit")


class CustomSearchLineEdit(SearchLineEdit, LineEditStyleMixin):
    """
    自定义样式的搜索输入框

    特性:
    - 继承 SearchLineEdit 的搜索图标和信号
    - 自动适应深色/浅色主题
    - 跨平台字体回落
    - 统一的视觉风格
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_style_mixin("CustomSearchLineEdit")
