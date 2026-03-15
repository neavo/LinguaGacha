from typing import Callable

from PySide6.QtCore import QEvent
from PySide6.QtCore import QObject
from PySide6.QtCore import Qt
from PySide6.QtCore import QTimer
from PySide6.QtGui import QTextOption
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
    - 支持通过 set_error() 显示错误状态
    - 支持通过 set_on_focus_out() 设置失去焦点回调
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

    # 错误状态边框颜色
    ERROR_BORDER = "#e74c3c"

    # 等宽字体回落: Windows → macOS → Linux → 通用
    FONT_MONOSPACE = (
        "Consolas, "  # Windows
        "'SF Mono', Menlo, "  # macOS
        "'Ubuntu Mono', "  # Linux
        "'Noto Sans Mono CJK SC', 'Noto Sans Mono CJK JP', "  # CJK 等宽
        "monospace"  # 通用回落
    )

    # 默认字体回落: 系统 UI → 各平台 → CJK → 通用
    FONT_DEFAULT = (
        "system-ui, "  # 现代浏览器/Qt 自动选择系统字体
        "'Segoe UI', "  # Windows
        "'-apple-system', 'SF Pro Text', 'Helvetica Neue', "  # macOS
        "'Ubuntu', 'Noto Sans', "  # Linux
        "'Microsoft YaHei', 'PingFang SC', "  # 中文
        "'Hiragino Sans', 'Meiryo', "  # 日文
        "sans-serif"  # 通用回落
    )

    def __init__(self, parent=None, monospace: bool = False):
        super().__init__(parent)

        self.monospace = monospace
        self.has_error = False
        self.on_focus_out: Callable[[], None] | None = None

        # 默认自动换行
        self.setLineWrapMode(PlainTextEdit.LineWrapMode.WidgetWidth)
        # 即使启用了自动换行，仍可能因长 token 出现横向滚动条，这里彻底关闭。
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        option = self.document().defaultTextOption()
        # 校对/编辑区包含长 URL、长 token 等内容时，按词语边界换行会留下大段空白。
        # 使用硬换行（任意位置断行）保证版面稳定。
        option.setWrapMode(QTextOption.WrapMode.WrapAnywhere)
        self.document().setDefaultTextOption(option)

        # 初始样式
        self.update_style()
        self.installEventFilter(self)

        # 监听主题变化，控件销毁时自动断开
        qconfig.themeChangedFinished.connect(self.refresh_style)
        self.destroyed.connect(self.disconnect_signals)

    def disconnect_signals(self) -> None:
        """断开全局信号连接，避免内存泄漏"""
        try:
            qconfig.themeChangedFinished.disconnect(self.refresh_style)
        except TypeError, RuntimeError:
            # Qt 对象销毁或重复断开连接时可能抛异常，可忽略。
            pass

    def setReadOnly(self, ro: bool) -> None:
        super().setReadOnly(ro)
        self.update_style()

    def refresh_style(self) -> None:
        # 主题切换时可能被全局样式覆盖，延迟一帧再刷新样式。
        QTimer.singleShot(0, self.update_style)

    def set_error(self, has_error: bool) -> None:
        """设置错误状态，显示红色边框"""
        if self.has_error != has_error:
            self.has_error = has_error
            self.update_style()

    def set_on_focus_out(self, callback: Callable[[], None]) -> None:
        """设置失去焦点时的回调函数"""
        self.on_focus_out = callback

    def eventFilter(self, a0: QObject | None, a1: QEvent | None) -> bool:
        if a0 is self and a1 is not None:
            if a1.type() == QEvent.Type.FocusOut and self.on_focus_out:
                self.on_focus_out()
            if a1.type() == QEvent.Type.Show:
                # 页面创建早于主题加载时，确保显示时样式同步
                self.update_style()
        return super().eventFilter(a0, a1)

    def update_style(self) -> None:
        is_dark = isDarkTheme()
        theme_color = themeColor().name()
        font_family = self.FONT_MONOSPACE if self.monospace else self.FONT_DEFAULT
        padding = 6 if bool(self.property("compact")) else 10

        # 使用 isReadOnly() 而非自定义变量，确保主题切换时与实际状态一致。
        is_readonly = self.isReadOnly()

        if is_readonly:
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

        # 错误状态覆盖边框颜色
        if self.has_error and not is_readonly:
            border = f"1px solid {self.ERROR_BORDER}"
            focus_border = f"1px solid {self.ERROR_BORDER}"

        self.setStyleSheet(f"""
            CustomTextEdit,
            CustomTextEdit PlainTextEdit,
            CustomTextEdit QPlainTextEdit {{
                background-color: {bg_color};
                border: {border};
                 border-radius: 6px;
                 color: {color};
                 font-family: {font_family};
                 padding: {padding}px;
                 selection-background-color: {theme_color};
             }}
            CustomTextEdit QPlainTextEdit::viewport {{
                background-color: {bg_color};
            }}
            CustomTextEdit:hover,
            CustomTextEdit PlainTextEdit:hover,
            CustomTextEdit QPlainTextEdit:hover {{
                border: {border};
                background-color: {bg_color};
            }}
            CustomTextEdit:focus,
            CustomTextEdit PlainTextEdit:focus,
            CustomTextEdit QPlainTextEdit:focus {{
                border: {focus_border};
                background-color: {bg_color};
            }}
        """)
