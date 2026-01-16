from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import IndeterminateProgressRing
from qfluentwidgets import InfoBar
from qfluentwidgets import InfoBarPosition
from qfluentwidgets import ProgressRing

class ProgressToast:
    """基于 InfoBar 的进度提示组件，左侧显示 loading 圆环"""

    def __init__(self, parent: QWidget = None) -> None:
        self._parent = parent
        self._info_bar: InfoBar = None
        self._indeterminate_ring: IndeterminateProgressRing = None
        self._progress_ring: ProgressRing = None
        self._is_indeterminate = True
        self._bottom_offset = 80

    def _create_info_bar(self, content: str, is_indeterminate: bool) -> InfoBar:
        """创建 InfoBar 实例"""
        # 关闭已存在的
        if self._info_bar:
            self._info_bar.close()
            self._info_bar = None

        self._is_indeterminate = is_indeterminate

        # 创建自定义 InfoBar（不使用图标）
        info_bar = InfoBar.new(
            icon=None,
            title="",
            content=content,
            orient=Qt.Orientation.Horizontal,
            isClosable=True,
            duration=-1,
            position=InfoBarPosition.NONE,
            parent=self._parent
        )

        # 根据模式创建对应的圆环
        if is_indeterminate:
            self._indeterminate_ring = IndeterminateProgressRing(info_bar)
            self._indeterminate_ring.setFixedSize(18, 18)
            self._indeterminate_ring.setStrokeWidth(3)
            ring_widget = self._indeterminate_ring
            self._progress_ring = None
        else:
            self._progress_ring = ProgressRing(info_bar)
            self._progress_ring.setFixedSize(18, 18)
            self._progress_ring.setStrokeWidth(3)
            self._progress_ring.setRange(0, 100)
            self._progress_ring.setValue(0)
            self._progress_ring.setTextVisible(False)
            ring_widget = self._progress_ring
            self._indeterminate_ring = None

        # 隐藏原始 iconWidget 并移除其布局占位
        info_bar.iconWidget.hide()
        info_bar.hBoxLayout.removeWidget(info_bar.iconWidget)

        # 调整 textLayout 对齐方式和边距，使其垂直居中
        info_bar.textLayout.setAlignment(Qt.AlignVCenter)
        info_bar.textLayout.setContentsMargins(0, 0, 0, 0)

        # 插入到 hBoxLayout 的最前面，圆环垂直居中对齐
        info_bar.hBoxLayout.insertSpacing(0, 8)
        info_bar.hBoxLayout.insertWidget(1, ring_widget, 0, Qt.AlignVCenter)
        info_bar.hBoxLayout.insertSpacing(2, 16)

        return info_bar

    def show_indeterminate(self, content: str) -> None:
        """显示不定进度模式"""
        self._info_bar = self._create_info_bar(content, True)
        self._info_bar.show()
        QTimer.singleShot(0, self._update_position)

    def show_progress(self, content: str, current: int = 0, total: int = 0) -> None:
        """显示确定进度模式"""
        if not self._info_bar or self._is_indeterminate:
            # 需要创建新的确定进度 InfoBar
            self._info_bar = self._create_info_bar(content, False)
            self._info_bar.show()
            QTimer.singleShot(0, self._update_position)

        self.set_content(content)
        self.set_progress(current, total)

    def set_progress(self, current: int, total: int) -> None:
        """更新进度"""
        if self._progress_ring and total > 0:
            percentage = int((current / total) * 100)
            self._progress_ring.setValue(percentage)

    def set_content(self, content: str) -> None:
        """更新文本内容"""
        if self._info_bar:
            self._info_bar.contentLabel.setText(content)

    def hide_toast(self) -> None:
        """隐藏进度提示"""
        if self._info_bar:
            self._info_bar.close()
            self._info_bar = None

    def isVisible(self) -> bool:
        """是否可见"""
        return self._info_bar is not None and self._info_bar.isVisible()

    def _update_position(self) -> None:
        """更新位置到父窗口底部中间"""
        if not self._info_bar or not self._parent:
            return

        parent_rect = self._parent.rect()
        self._info_bar.adjustSize()

        x = (parent_rect.width() - self._info_bar.width()) // 2
        y = parent_rect.height() - self._info_bar.height() - self._bottom_offset
        self._info_bar.move(x, y)

    def set_bottom_offset(self, offset: int) -> None:
        """设置距离底部的偏移量"""
        self._bottom_offset = offset
