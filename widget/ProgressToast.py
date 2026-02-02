from typing import Any
from typing import cast

from PyQt5 import sip
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import IndeterminateProgressRing
from qfluentwidgets import InfoBar
from qfluentwidgets import InfoBarPosition
from qfluentwidgets import ProgressRing


class ProgressToast:
    """基于 InfoBar 的进度提示组件，左侧显示 loading 圆环"""

    def __init__(self, parent: QWidget) -> None:
        self.parent_widget = parent
        self.info_bar: InfoBar | None = None
        self.indeterminate_ring: IndeterminateProgressRing | None = None
        self.progress_ring: ProgressRing | None = None
        self.is_indeterminate = True
        self.bottom_offset = 80

    def apply_relayout(self) -> None:
        """根据当前内容重算尺寸，并重新居中定位。"""

        self.ensure_widgets_alive()
        if self.info_bar is None:
            return

        adjust_text = getattr(self.info_bar, "_adjustText", None)
        try:
            if callable(adjust_text):
                adjust_text()
            else:
                self.info_bar.adjustSize()
        except RuntimeError:
            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None
            return

        self.update_position()

    def is_qt_object_alive(self, obj: object | None) -> bool:
        """判断 Qt 对象是否仍然可用。

        InfoBar 关闭会触发 deleteLater()，此时 Python 侧引用仍在，但底层 C++ 对象已销毁。
        若继续访问会抛 RuntimeError: wrapped C/C++ object ... has been deleted。
        """

        if obj is None:
            return False

        try:
            return not sip.isdeleted(cast(Any, obj))
        except Exception:
            # 兜底：在少数情况下 sip.isdeleted 可能不可用或不接受该对象
            try:
                getattr(obj, "objectName")()
            except Exception:
                return False
            return True

    def ensure_widgets_alive(self) -> None:
        """清理已被 Qt 销毁的 widget 引用，避免后续更新触发崩溃。"""

        if self.info_bar is not None and not self.is_qt_object_alive(self.info_bar):
            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None
            return

        if self.indeterminate_ring is not None and not self.is_qt_object_alive(
            self.indeterminate_ring
        ):
            self.indeterminate_ring = None

        if self.progress_ring is not None and not self.is_qt_object_alive(
            self.progress_ring
        ):
            self.progress_ring = None

    def on_info_bar_closed(self, info_bar: InfoBar) -> None:
        """InfoBar 被用户手动关闭时清空引用。"""

        if self.info_bar is not info_bar:
            return

        self.info_bar = None
        self.indeterminate_ring = None
        self.progress_ring = None

    def create_info_bar(self, content: str, is_indeterminate: bool) -> InfoBar:
        """创建 InfoBar 实例"""
        self.ensure_widgets_alive()

        # 关闭已存在的
        if self.info_bar is not None:
            try:
                self.info_bar.close()
            except RuntimeError:
                pass

            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None

        self.is_indeterminate = is_indeterminate

        # 创建自定义 InfoBar（不使用图标）
        info_bar = InfoBar.new(
            icon=None,
            title="",
            content=content,
            orient=Qt.Orientation.Horizontal,
            isClosable=True,
            duration=-1,
            position=InfoBarPosition.NONE,
            parent=self.parent_widget,
        )

        # 允许用户主动关闭，不再接收后续更新，避免访问已销毁的 Qt 对象
        info_bar.closedSignal.connect(lambda: self.on_info_bar_closed(info_bar))

        # 同时创建两种圆环，以便动态切换
        indeterminate_ring = IndeterminateProgressRing(info_bar)
        indeterminate_ring.setFixedSize(18, 18)
        indeterminate_ring.setStrokeWidth(3)
        self.indeterminate_ring = indeterminate_ring

        progress_ring = ProgressRing(info_bar)
        progress_ring.setFixedSize(18, 18)
        progress_ring.setStrokeWidth(3)
        progress_ring.setRange(0, 100)
        progress_ring.setValue(0)
        progress_ring.setTextVisible(False)
        self.progress_ring = progress_ring

        # 隐藏原始 iconWidget 并移除其布局占位
        info_bar.iconWidget.hide()
        info_bar.hBoxLayout.removeWidget(info_bar.iconWidget)

        # 调整 textLayout 对齐方式和边距，使其垂直居中
        align_vcenter = getattr(Qt, "AlignVCenter")
        info_bar.textLayout.setAlignment(align_vcenter)
        info_bar.textLayout.setContentsMargins(0, 0, 0, 0)

        # 插入圆环到布局中
        info_bar.hBoxLayout.insertSpacing(0, 8)
        info_bar.hBoxLayout.insertWidget(1, indeterminate_ring, 0, align_vcenter)
        info_bar.hBoxLayout.insertWidget(2, progress_ring, 0, align_vcenter)
        info_bar.hBoxLayout.insertSpacing(3, 16)

        # 根据初始模式显示对应的圆环
        if is_indeterminate:
            progress_ring.hide()
            indeterminate_ring.show()
        else:
            indeterminate_ring.hide()
            progress_ring.show()

        return info_bar

    def show_indeterminate(self, content: str) -> None:
        """显示不定进度模式"""
        self.ensure_widgets_alive()

        if self.info_bar is not None:
            self.set_content(content)
            if not self.is_indeterminate:
                self.switch_to_indeterminate()
            return

        info_bar = self.create_info_bar(content, True)
        self.info_bar = info_bar
        info_bar.show()
        QTimer.singleShot(0, self.update_position)

    def show_progress(self, content: str, current: int = 0, total: int = 0) -> None:
        """显示确定进度模式"""
        self.ensure_widgets_alive()

        if self.info_bar is None:
            info_bar = self.create_info_bar(content, False)
            self.info_bar = info_bar
            info_bar.show()
            QTimer.singleShot(0, self.update_position)
        elif self.is_indeterminate:
            self.switch_to_determinate()

        self.set_content(content)
        self.set_progress(current, total)

    def set_progress(self, current: int, total: int) -> None:
        """更新进度"""
        self.ensure_widgets_alive()

        if (
            self.progress_ring is not None
            and self.is_qt_object_alive(self.progress_ring)
            and total > 0
        ):
            percentage = int((current / total) * 100)
            self.progress_ring.setValue(percentage)

            # 当进度达到 100% 时，自动切换到不定状态，消除“卡住”感
            if percentage >= 100 and not self.is_indeterminate:
                self.switch_to_indeterminate()

    def set_content(self, content: str) -> None:
        """更新文本内容"""
        self.ensure_widgets_alive()

        if self.info_bar is None:
            return

        content_label = getattr(self.info_bar, "contentLabel", None)
        if content_label is None:
            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None
            return

        if not self.is_qt_object_alive(content_label):
            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None
            return

        # 同步 InfoBar 内部状态，避免窗口 resize 时 _adjustText() 用旧 content 覆盖显示。
        self.info_bar.content = content
        content_label.setVisible(bool(content))
        content_label.setText(content)
        self.apply_relayout()

    def switch_to_indeterminate(self) -> None:
        """平滑切换到不定进度模式"""
        self.ensure_widgets_alive()
        if not self.info_bar or self.is_indeterminate:
            return

        progress_ring = self.progress_ring
        indeterminate_ring = self.indeterminate_ring
        if progress_ring is None or indeterminate_ring is None:
            return

        self.is_indeterminate = True
        progress_ring.hide()
        indeterminate_ring.show()

    def switch_to_determinate(self) -> None:
        """平滑切换到确定进度模式"""
        self.ensure_widgets_alive()
        if not self.info_bar or not self.is_indeterminate:
            return

        progress_ring = self.progress_ring
        indeterminate_ring = self.indeterminate_ring
        if progress_ring is None or indeterminate_ring is None:
            return

        self.is_indeterminate = False
        indeterminate_ring.hide()
        progress_ring.show()

    def hide_toast(self) -> None:
        """隐藏进度提示"""
        self.ensure_widgets_alive()

        if self.info_bar is None:
            return

        try:
            self.info_bar.close()
        except RuntimeError:
            pass

        self.info_bar = None
        self.indeterminate_ring = None
        self.progress_ring = None

    def is_visible(self) -> bool:
        """是否可见"""
        self.ensure_widgets_alive()

        if self.info_bar is None:
            return False

        try:
            return self.info_bar.isVisible()
        except RuntimeError:
            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None
            return False

    def update_position(self) -> None:
        """更新位置到父窗口底部中间"""
        self.ensure_widgets_alive()

        if self.info_bar is None or not self.parent_widget:
            return

        parent_rect = self.parent_widget.rect()
        try:
            self.info_bar.adjustSize()
        except RuntimeError:
            self.info_bar = None
            self.indeterminate_ring = None
            self.progress_ring = None
            return

        x = (parent_rect.width() - self.info_bar.width()) // 2
        y = parent_rect.height() - self.info_bar.height() - self.bottom_offset
        self.info_bar.move(x, y)

    def set_bottom_offset(self, offset: int) -> None:
        """设置距离底部的偏移量"""
        self.bottom_offset = offset
