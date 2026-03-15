from typing import Callable

from PySide6.QtCore import QTime
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import TimeEdit

from module.Localizer.Localizer import Localizer


class TimerMessageBox(MessageBoxBase):
    def __init__(self, parent, title: str, message_box_close: Callable = None) -> None:
        super().__init__(parent=parent)

        # 初始化
        self.delay = 0
        self.message_box_close = message_box_close

        # 设置框体
        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

        # 设置主布局
        self.viewLayout.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 标题
        self.title_label = StrongBodyLabel(title, self)
        self.viewLayout.addWidget(self.title_label)

        # 输入框
        self.time_edit = TimeEdit(self)
        self.time_edit.setMinimumWidth(256)
        self.time_edit.setTimeRange(QTime(0, 0), QTime(23, 59))
        self.time_edit.setTime(QTime(2, 0))
        self.viewLayout.addWidget(self.time_edit)

    # 重写验证方法
    def validate(self) -> bool:
        if callable(self.message_box_close):
            self.message_box_close(self, self.time_edit.time())

        return True
