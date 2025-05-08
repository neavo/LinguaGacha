from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout

from qfluentwidgets import CardWidget
from qfluentwidgets import Action
from qfluentwidgets import CommandBar
from qfluentwidgets.components.widgets.command_bar import CommandButton

class CommandBarCard(CardWidget):

    def __init__(self) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.hbox = QHBoxLayout(self)
        self.hbox.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 文本控件
        self.command_bar = CommandBar()
        self.command_bar.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        self.hbox.addWidget(self.command_bar)

    def add_widget(self, widget) -> None:
        return self.hbox.addWidget(widget)

    def add_stretch(self, stretch: int) -> None:
        self.hbox.addStretch(stretch)

    def add_spacing(self, spacing: int) -> None:
        self.hbox.addSpacing(spacing)

    def add_action(self, action: Action) -> CommandButton:
        return self.command_bar.addAction(action)

    def add_separator(self) -> None:
        self.command_bar.addSeparator()

    def set_minimum_width(self, min_width: int) -> None:
        self.command_bar.setMinimumWidth(min_width)