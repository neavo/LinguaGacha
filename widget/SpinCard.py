from typing import Callable

from PySide6.QtGui import QColor
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from qfluentwidgets import CardWidget
from qfluentwidgets import SpinBox
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel


class SpinCard(CardWidget):
    def __init__(
        self,
        title: str,
        description: str,
        init: Callable = None,
        value_changed: Callable = None,
    ) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.container = QHBoxLayout(self)
        self.container.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()

        self.title_label = StrongBodyLabel(title, self)
        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))

        self.vbox.addWidget(self.title_label)
        self.vbox.addWidget(self.description_label)
        self.container.addLayout(self.vbox)

        # 填充
        self.container.addStretch(1)

        # 微调框控件
        self.spin_box = SpinBox()
        self.container.addWidget(self.spin_box)

        if callable(init):
            init(self)

        if callable(value_changed):
            self.spin_box.valueChanged.connect(lambda _: value_changed(self))

    def get_spin_box(self) -> SpinBox:
        return self.spin_box
