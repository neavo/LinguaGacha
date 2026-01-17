from typing import Callable

from PyQt5.QtWidgets import QWidget
from qfluentwidgets import LineEdit
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import StrongBodyLabel

from module.Localizer.Localizer import Localizer

class LineEditMessageBox(MessageBoxBase):

    def __init__(self, parent: QWidget, title: str, message_box_close: Callable = None) -> None:
        super().__init__(parent = parent)

        # 初始化
        self.message_box_close = message_box_close

        # 设置框体
        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

        # 设置主布局
        self.viewLayout.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 标题
        self.title_label = StrongBodyLabel(title, self)
        self.viewLayout.addWidget(self.title_label)

        # 输入框
        self.line_edit = LineEdit(self)
        self.line_edit.setMinimumWidth(384)
        self.line_edit.setClearButtonEnabled(True)
        self.viewLayout.addWidget(self.line_edit)

    # 重写验证方法
    def validate(self) -> bool:
        if self.line_edit.text().strip() != "":
            if callable(self.message_box_close):
                self.message_box_close(self, self.line_edit.text())

            return True

    def get_line_edit(self) -> LineEdit:
        return self.line_edit