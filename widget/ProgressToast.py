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
        self.parent_widget = parent
        self.info_bar: InfoBar = None
        self.indeterminate_ring: IndeterminateProgressRing = None
        self.progress_ring: ProgressRing = None
        self.is_indeterminate = True
        self.bottom_offset = 80

    def create_info_bar(self, content: str, is_indeterminate: bool) -> InfoBar:
        """创建 InfoBar 实例"""
        # 关闭已存在的
        if self.info_bar:
            self.info_bar.close()
            self.info_bar = None

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

        # 同时创建两种圆环，以便动态切换
        self.indeterminate_ring = IndeterminateProgressRing(info_bar)
        self.indeterminate_ring.setFixedSize(18, 18)
        self.indeterminate_ring.setStrokeWidth(3)

        self.progress_ring = ProgressRing(info_bar)
        self.progress_ring.setFixedSize(18, 18)
        self.progress_ring.setStrokeWidth(3)
        self.progress_ring.setRange(0, 100)
        self.progress_ring.setValue(0)
        self.progress_ring.setTextVisible(False)

        # 隐藏原始 iconWidget 并移除其布局占位
        info_bar.iconWidget.hide()
        info_bar.hBoxLayout.removeWidget(info_bar.iconWidget)

        # 调整 textLayout 对齐方式和边距，使其垂直居中
        info_bar.textLayout.setAlignment(Qt.AlignVCenter)
        info_bar.textLayout.setContentsMargins(0, 0, 0, 0)

        # 插入圆环到布局中
        info_bar.hBoxLayout.insertSpacing(0, 8)
        info_bar.hBoxLayout.insertWidget(1, self.indeterminate_ring, 0, Qt.AlignVCenter)
        info_bar.hBoxLayout.insertWidget(2, self.progress_ring, 0, Qt.AlignVCenter)
        info_bar.hBoxLayout.insertSpacing(3, 16)

        # 根据初始模式显示对应的圆环
        if is_indeterminate:
            self.progress_ring.hide()
            self.indeterminate_ring.show()
        else:
            self.indeterminate_ring.hide()
            self.progress_ring.show()

        return info_bar

    def show_indeterminate(self, content: str) -> None:
        """显示不定进度模式"""
        if self.info_bar:
            self.set_content(content)
            if not self.is_indeterminate:
                self.switch_to_indeterminate()
            return

        self.info_bar = self.create_info_bar(content, True)
        self.info_bar.show()
        QTimer.singleShot(0, self.update_position)

    def show_progress(self, content: str, current: int = 0, total: int = 0) -> None:
        """显示确定进度模式"""
        if not self.info_bar:
            self.info_bar = self.create_info_bar(content, False)
            self.info_bar.show()
            QTimer.singleShot(0, self.update_position)
        elif self.is_indeterminate:
            self.switch_to_determinate()

        self.set_content(content)
        self.set_progress(current, total)

    def set_progress(self, current: int, total: int) -> None:
        """更新进度"""
        if self.progress_ring and total > 0:
            percentage = int((current / total) * 100)
            self.progress_ring.setValue(percentage)

            # 当进度达到 100% 时，自动切换到不定状态，消除“卡住”感
            if percentage >= 100 and not self.is_indeterminate:
                self.switch_to_indeterminate()

    def set_content(self, content: str) -> None:
        """更新文本内容"""
        if self.info_bar:
            self.info_bar.contentLabel.setText(content)

    def switch_to_indeterminate(self) -> None:
        """平滑切换到不定进度模式"""
        if not self.info_bar or self.is_indeterminate:
            return

        self.is_indeterminate = True
        self.progress_ring.hide()
        self.indeterminate_ring.show()

    def switch_to_determinate(self) -> None:
        """平滑切换到确定进度模式"""
        if not self.info_bar or not self.is_indeterminate:
            return

        self.is_indeterminate = False
        self.indeterminate_ring.hide()
        self.progress_ring.show()

    def hide_toast(self) -> None:
        """隐藏进度提示"""
        if self.info_bar:
            self.info_bar.close()
            self.info_bar = None

    def is_visible(self) -> bool:
        """是否可见"""
        return self.info_bar is not None and self.info_bar.isVisible()

    def update_position(self) -> None:
        """更新位置到父窗口底部中间"""
        if not self.info_bar or not self.parent_widget:
            return

        parent_rect = self.parent_widget.rect()
        self.info_bar.adjustSize()

        x = (parent_rect.width() - self.info_bar.width()) // 2
        y = parent_rect.height() - self.info_bar.height() - self.bottom_offset
        self.info_bar.move(x, y)

    def set_bottom_offset(self, offset: int) -> None:
        """设置距离底部的偏移量"""
        self.bottom_offset = offset
