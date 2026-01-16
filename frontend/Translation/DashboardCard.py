from typing import Callable

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import LargeTitleLabel
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import SubtitleLabel

from widget.Separator import Separator

class DashboardCard(CardWidget):

    def __init__(self, parent: QWidget, title: str, value: str, unit: str, init: Callable = None, clicked: Callable = None) -> None:
        super().__init__(parent)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        self.title_label = SubtitleLabel(title, self)
        self.root.addWidget(self.title_label)

        # 添加分割线
        self.root.addWidget(Separator(self))

        # 添加控件
        self.body_hbox_container = QWidget(self)
        self.body_hbox = QHBoxLayout(self.body_hbox_container)
        self.body_hbox.setSpacing(0)
        self.body_hbox.setContentsMargins(0, 0, 0, 0)

        self.unit_vbox_container = QWidget(self)
        self.unit_vbox = QVBoxLayout(self.unit_vbox_container)
        self.unit_vbox.setSpacing(0)
        self.unit_vbox.setContentsMargins(0, 0, 0, 0)

        self.unit_label = StrongBodyLabel(unit, self)
        self.unit_label.setAlignment(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft)
        self.unit_vbox.addSpacing(20)
        self.unit_vbox.addWidget(self.unit_label)

        self.value_label = LargeTitleLabel(value, self)
        self.value_label.setAlignment(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight)

        self.body_hbox.addStretch(1)
        self.body_hbox.addWidget(self.value_label, 1)
        self.body_hbox.addSpacing(6)
        self.body_hbox.addWidget(self.unit_vbox_container)
        self.body_hbox.addStretch(1)
        self.root.addWidget(self.body_hbox_container, 1)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda : clicked(self))

    def set_unit(self, unit: str) -> None:
        self.unit_label.setText(unit)

    def set_value(self, value: str) -> None:
        self.value_label.setText(value)
