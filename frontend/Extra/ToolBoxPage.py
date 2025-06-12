from typing import Callable

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FlowLayout
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import SubtitleLabel
from qfluentwidgets import TransparentToolButton

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.Separator import Separator

class ItemCard(CardWidget):

    def __init__(self, parent: QWidget, title: str, description: str, init: Callable = None, clicked: Callable = None) -> None:
        super().__init__(parent)

        # 设置容器
        self.setFixedSize(300, 150)
        self.setBorderRadius(4)
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 添加标题
        self.head_hbox_container = QWidget(self)
        self.head_hbox = QHBoxLayout(self.head_hbox_container)
        self.head_hbox.setSpacing(0)
        self.head_hbox.setContentsMargins(0, 0, 0, 0)
        self.root.addWidget(self.head_hbox_container)

        self.title_label = SubtitleLabel(title, self)
        self.title_label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents) # 在上层控件上禁用鼠标事件以将事件向下层传播
        self.head_hbox.addWidget(self.title_label)
        self.head_hbox.addStretch(1)
        self.title_button = TransparentToolButton(FluentIcon.PAGE_RIGHT)
        self.head_hbox.addWidget(self.title_button)

        # 添加分割线
        self.root.addWidget(Separator(self))

        # 添加描述
        self.description_label = CaptionLabel(description, self)
        self.description_label.setWordWrap(True)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.description_label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents) # 在上层控件上禁用鼠标事件以将事件向下层传播
        self.root.addWidget(self.description_label, 1)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda : clicked(self))
            self.title_button.clicked.connect(lambda : clicked(self))


class ToolBoxPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加流式布局容器
        self.flow_container = QWidget(self)
        self.flow_layout = FlowLayout(self.flow_container, needAni = False)
        self.flow_layout.setSpacing(8)
        self.flow_layout.setContentsMargins(0, 0, 0, 0)
        self.vbox.addWidget(self.flow_container)

        # 添加控件
        self.add_batch_correction(self.flow_layout, config, window)
        self.add_re_translation(self.flow_layout, config, window)
        self.add_name_field_extraction(self.flow_layout, config, window)

    # 批量修正
    def add_batch_correction(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def clicked(widget: ItemCard) -> None:
            window.switchTo(window.batch_correction_page)

        parent.addWidget(ItemCard(
            parent = self,
            title = Localizer.get().tool_box_page_batch_correction,
            description = Localizer.get().tool_box_page_batch_correction_desc,
            init = None,
            clicked = clicked,
        ))

    # 部分重翻
    def add_re_translation(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def clicked(widget: ItemCard) -> None:
            window.switchTo(window.re_translation_page)

        parent.addWidget(ItemCard(
            parent = self,
            title = Localizer.get().tool_box_page_re_translation,
            description = Localizer.get().tool_box_page_re_translation_desc,
            init = None,
            clicked = clicked,
        ))

    # 姓名字段提取
    def add_name_field_extraction(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def clicked(widget: ItemCard) -> None:
            window.switchTo(window.name_field_extraction_page)

        parent.addWidget(ItemCard(
            parent = self,
            title = Localizer.get().tool_box_page_name_field_extraction,
            description = Localizer.get().tool_box_page_name_field_extraction_desc,
            init = None,
            clicked = clicked,
        ))