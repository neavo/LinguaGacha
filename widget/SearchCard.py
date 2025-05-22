from typing import Callable

from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import LineEdit
from qfluentwidgets import TransparentPushButton

from module.Localizer.Localizer import Localizer

class SearchCard(CardWidget):

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 添加控件
        self.line_edit = LineEdit()
        self.line_edit.setFixedWidth(256)
        self.line_edit.setPlaceholderText(Localizer.get().placeholder)
        self.line_edit.setClearButtonEnabled(True)
        self.root.addWidget(self.line_edit)

        self.next = TransparentPushButton(self)
        self.next.setIcon(FluentIcon.SCROLL)
        self.next.setText(Localizer.get().next)
        self.root.addWidget(self.next)

        # 填充
        self.root.addStretch(1)

        # 返回
        self.back = TransparentPushButton(self)
        self.back.setIcon(FluentIcon.EMBED)
        self.back.setText(Localizer.get().back)
        self.root.addWidget(self.back)

    def on_next_clicked(self, clicked: Callable) -> None:
        self.next.clicked.connect(lambda: clicked(self))

    def on_back_clicked(self, clicked: Callable) -> None:
        self.back.clicked.connect(lambda: clicked(self))

    def get_line_edit(self) -> LineEdit:
        return self.line_edit