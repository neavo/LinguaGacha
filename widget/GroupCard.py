from typing import Callable

from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import StrongBodyLabel

from widget.Separator import Separator


class GroupCard(CardWidget):
    def __init__(
        self,
        parent: QWidget,
        title: str,
        description: str = None,
        init: Callable = None,
        clicked: Callable = None,
    ) -> None:
        super().__init__(parent)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 标题行使用水平布局，支持右侧添加控件
        self.header_hbox = QHBoxLayout()
        self.header_hbox.setContentsMargins(0, 0, 0, 0)

        # 标题和描述使用垂直布局
        self.title_vbox = QVBoxLayout()
        self.title_vbox.setContentsMargins(0, 0, 0, 0)
        self.title_label = StrongBodyLabel(title, self)
        self.title_vbox.addWidget(self.title_label)

        if description:
            self.description_label = CaptionLabel(description, self)
            self.description_label.setTextColor(
                QColor(96, 96, 96), QColor(160, 160, 160)
            )
            self.title_vbox.addWidget(self.description_label)

        self.header_hbox.addLayout(self.title_vbox)
        self.header_hbox.addStretch(1)
        self.root.addLayout(self.header_hbox)

        # 添加分割线
        self.root.addWidget(Separator(self))

        # 添加流式布局容器
        self.vbox_container = QWidget(self)
        self.vbox = QVBoxLayout(self.vbox_container)
        self.vbox.setSpacing(0)
        self.vbox.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.vbox_container)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda: clicked(self))

    # 添加控件到标题行右侧
    def add_header_widget(self, widget) -> None:
        self.header_hbox.addWidget(widget)

    # 添加控件到内容区域
    def add_widget(self, widget) -> None:
        self.vbox.addWidget(widget)
