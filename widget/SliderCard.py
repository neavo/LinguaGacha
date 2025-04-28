from typing import Callable

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import Slider
from qfluentwidgets import CardWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel

class SliderCard(CardWidget):

    def __init__(self, title: str, description: str, init: Callable = None, slider_released: Callable = None) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()

        self.title_label = StrongBodyLabel(title, self)
        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))

        self.vbox.addWidget(self.title_label)
        self.vbox.addWidget(self.description_label)
        self.root.addLayout(self.vbox)

        # 填充
        self.root.addStretch(1)

        # 添加控件
        self.slider = Slider(Qt.Orientation.Horizontal)
        self.slider.setFixedWidth(256)
        self.slider_value_label = StrongBodyLabel(title, self)
        self.slider_value_label.setFixedWidth(48)
        self.slider_value_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.root.addWidget(self.slider)
        self.root.addWidget(self.slider_value_label)

        if callable(init):
            init(self)

        if callable(slider_released):
            self.slider.sliderReleased.connect(lambda: slider_released(self))

    def set_text(self, text:str) -> None:
        self.slider_value_label.setText(text)

    def get_value(self) -> int:
        return self.slider.value()

    def set_value(self, value: int) -> None:
        self.slider.setValue(value)

    def set_range(self, min: int, max: int) -> None:
        self.slider.setRange(min, max)

    def add_widget(self, widget: QWidget) -> None:
        self.root.addWidget(widget)

    def set_visible(self, enabled: bool) -> None:
        self.slider.setVisible(enabled)
        self.slider_value_label.setVisible(enabled)