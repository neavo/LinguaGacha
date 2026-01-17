from qfluentwidgets import PlainTextEdit
from qfluentwidgets import isDarkTheme
from qfluentwidgets import qconfig
from qfluentwidgets import themeColor

class CustomTextEdit(PlainTextEdit):
    """
    自定义样式的文本编辑框

    特性:
    - 自动适应深色/浅色主题
    - 只读模式与编辑模式有视觉区分
    - 默认自动换行
    """

    # 深色主题颜色
    DARK_BG_READONLY = "rgba(255, 255, 255, 0.05)"
    DARK_BG_EDITABLE = "rgba(255, 255, 255, 0.08)"
    DARK_TEXT_READONLY = "rgba(255, 255, 255, 0.5)"
    DARK_TEXT_EDITABLE = "rgba(255, 255, 255, 0.9)"
    DARK_BORDER = "rgba(255, 255, 255, 0.1)"

    # 浅色主题颜色
    LIGHT_BG_READONLY = "rgba(0, 0, 0, 0.04)"
    LIGHT_BG_EDITABLE = "rgba(255, 255, 255, 0.8)"
    LIGHT_TEXT_READONLY = "rgba(0, 0, 0, 0.5)"
    LIGHT_TEXT_EDITABLE = "rgba(0, 0, 0, 0.9)"
    LIGHT_BORDER = "rgba(0, 0, 0, 0.1)"

    # 等宽字体回落: Windows → macOS → Linux → 通用
    FONT_MONOSPACE = (
        "Consolas, "              # Windows
        "'SF Mono', Menlo, "      # macOS
        "'Ubuntu Mono', "         # Linux
        "'Noto Sans Mono CJK SC', 'Noto Sans Mono CJK JP', "  # CJK 等宽
        "monospace"               # 通用回落
    )

    # 默认字体回落: 系统 UI → 各平台 → CJK → 通用
    FONT_DEFAULT = (
        "system-ui, "                                          # 现代浏览器/Qt 自动选择系统字体
        "'Segoe UI', "                                         # Windows
        "'-apple-system', 'SF Pro Text', 'Helvetica Neue', "   # macOS
        "'Ubuntu', 'Noto Sans', "                              # Linux
        "'Microsoft YaHei', 'PingFang SC', "                   # 中文
        "'Hiragino Sans', 'Meiryo', "                          # 日文
        "sans-serif"                                           # 通用回落
    )

    def __init__(self, parent=None, monospace: bool = False):
        super().__init__(parent)

        self._is_read_only = False
        self._monospace = monospace

        # 默认自动换行
        self.setLineWrapMode(PlainTextEdit.LineWrapMode.WidgetWidth)

        # 初始样式
        self.update_style()

        # 监听主题变化，控件销毁时自动断开
        qconfig.themeChanged.connect(self.update_style)
        self.destroyed.connect(self._disconnect_signals)

    def _disconnect_signals(self) -> None:
        """ 断开全局信号连接，避免内存泄漏 """
        try:
            qconfig.themeChanged.disconnect(self.update_style)
        except (TypeError, RuntimeError):
            pass

    def setReadOnly(self, read_only: bool) -> None:
        self._is_read_only = read_only
        super().setReadOnly(read_only)
        self.update_style()

    def update_style(self) -> None:
        is_dark = isDarkTheme()
        theme_color = themeColor().name()
        font_family = self.FONT_MONOSPACE if self._monospace else self.FONT_DEFAULT

        if self._is_read_only:
            if is_dark:
                bg_color = self.DARK_BG_READONLY
                border = "1px solid transparent"
                color = self.DARK_TEXT_READONLY
            else:
                bg_color = self.LIGHT_BG_READONLY
                border = "1px solid transparent"
                color = self.LIGHT_TEXT_READONLY
            focus_border = border
        else:
            if is_dark:
                bg_color = self.DARK_BG_EDITABLE
                border = f"1px solid {self.DARK_BORDER}"
                color = self.DARK_TEXT_EDITABLE
            else:
                bg_color = self.LIGHT_BG_EDITABLE
                border = f"1px solid {self.LIGHT_BORDER}"
                color = self.LIGHT_TEXT_EDITABLE
            # 编辑模式下焦点时显示主题色边框
            focus_border = f"1px solid {theme_color}"

        self.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: {bg_color};
                border: {border};
                border-radius: 6px;
                color: {color};
                font-family: {font_family};
                padding: 10px;
                selection-background-color: {theme_color};
            }}
            QPlainTextEdit:focus {{
                border: {focus_border};
                background-color: {bg_color};
            }}
        """)
