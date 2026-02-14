from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QWidget
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from qfluentwidgets import Slider
from qfluentwidgets import CardWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel


class SliderCard(CardWidget):
    def __init__(
        self,
        title: str,
        description: str,
        init: Callable = None,
        slider_released: Callable = None,
    ) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

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
        self.value_label = StrongBodyLabel(title, self)
        self.value_label.setFixedWidth(48)
        self.value_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.root.addWidget(self.slider)
        self.root.addWidget(self.value_label)

        if callable(init):
            init(self)

        if callable(slider_released):
            self.slider.sliderReleased.connect(lambda: slider_released(self))

    def get_slider(self) -> Slider:
        return self.slider

    def get_value_label(self) -> CaptionLabel:
        return self.value_label

    def add_widget(self, widget: QWidget) -> None:
        self.root.addWidget(widget)

    def set_slider_visible(self, enabled: bool) -> None:
        self.slider.setVisible(enabled)
        self.value_label.setVisible(enabled)
