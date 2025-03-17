from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QVBoxLayout

class Separator(QWidget):

    def __init__(self) -> None:
        super().__init__(None)

        # 设置容器
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(4, 8, 4, 8) # 左、上、右、下

        # 添加分割线
        line = QWidget(self)
        line.setFixedHeight(1)
        line.setStyleSheet("QWidget { background-color: #C0C0C0; }")
        self.root.addWidget(line)