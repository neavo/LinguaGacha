from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QVBoxLayout

class Separator(QWidget):

    def __init__(self, parent: QWidget = None, horizontal: bool = False) -> None:
        super().__init__(parent)

        if horizontal == True:
            # 设置容器
            self.root = QVBoxLayout(self)
            self.root.setContentsMargins(4, 0, 4, 0) # 左、上、右、下

            # 添加分割线
            line = QWidget(self)
            line.setFixedWidth(1)
            line.setStyleSheet("QWidget { background-color: #C0C0C0; }")
            self.root.addWidget(line)
        else:
            # 设置容器
            self.root = QVBoxLayout(self)
            self.root.setContentsMargins(0, 4, 0, 4) # 左、上、右、下

            # 添加分割线
            line = QWidget(self)
            line.setFixedHeight(1)
            line.setStyleSheet("QWidget { background-color: #C0C0C0; }")
            self.root.addWidget(line)