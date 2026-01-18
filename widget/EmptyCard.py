import re
from typing import Callable

from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import HyperlinkLabel
from qfluentwidgets import StrongBodyLabel

class EmptyCard(CardWidget):

    def __init__(self, title: str, description: str, init: Callable = None) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()
        self.root.addLayout(self.vbox)

        self.title_label = StrongBodyLabel(title, self)
        self.vbox.addWidget(self.title_label)

        # 使用正则表达式匹配超链接格式 [文本](URL)
        pattern = r'\[([^\]]+)\]\(([^)]+)\)'
        parts = re.split(pattern, description)

        # 如果没有找到超链接格式，使用普通的CaptionLabel
        if len(parts) == 1:
            self.description_label = CaptionLabel(description, self)
            self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
            self.vbox.addWidget(self.description_label)
        else:
            self.description_label = None # 存在超链接时，不支持获取 description_label

            # 解析描述文本中的超链接
            self.description_container = QWidget()
            self.description_layout = QHBoxLayout(self.description_container)
            self.description_layout.setContentsMargins(0, 0, 0, 0)
            self.description_layout.setSpacing(0)

            # 处理包含超链接的文本
            for i, part in enumerate(parts):
                if i % 3 == 0:  # 普通文本
                    if part:  # 非空字符串
                        label = CaptionLabel(part, self)
                        label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
                        self.description_layout.addWidget(label)
                elif i % 3 == 1:  # 超链接文本
                    link_text = part
                elif i % 3 == 2:  # 超链接URL
                    url = part
                    link_label = HyperlinkLabel(link_text, self)
                    # 设置超链接标签的字体大小与CaptionLabel一致
                    # 获取CaptionLabel的字体大小并应用到HyperlinkLabel
                    caption_font = CaptionLabel("", self).font()
                    link_label.setFont(caption_font)
                    link_label.setUrl(url)
                    # clicked信号会传递一个bool参数，表示是否按住了Ctrl键
                    # 我们需要在lambda函数中接收这个参数，以避免覆盖默认的url参数
                    link_label.clicked.connect(lambda checked, u=url: QDesktopServices.openUrl(QUrl(u)))
                    self.description_layout.addWidget(link_label)

            self.description_layout.addStretch(1)
            self.vbox.addWidget(self.description_container)

        # 填充
        self.root.addStretch(1)

        if callable(init):
            init(self)

    def get_title_label(self) -> StrongBodyLabel:
        return self.title_label

    def get_description_label(self) -> CaptionLabel:
        return self.description_label

    def add_widget(self, widget) -> None:
        self.root.addWidget(widget)

    def add_spacing(self, space: int) -> None:
        self.root.addSpacing(space)

    def remove_title(self) -> None:
        self.vbox.removeWidget(self.title_label)