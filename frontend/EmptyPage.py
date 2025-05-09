from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentWindow

class EmptyPage(QWidget):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))