from typing import Self
from typing import Callable

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QObject
from PyQt5.QtCore import pyqtSignal

class EventManager(QObject):

    # 自定义信号
    # 字典类型或者其他复杂对象应该使用 object 作为信号参数类型，这样可以传递任意 Python 对象，包括 dict
    signal: pyqtSignal = pyqtSignal(str, object)

    # 事件列表
    event_callbacks: dict[str, list[Callable]] = {}

    def __init__(self) -> None:
        super().__init__()
        self.signal.connect(self.process_event, Qt.ConnectionType.QueuedConnection)

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__

    # 处理事件
    def process_event(self, event: str, data: dict) -> None:
        if event in self.event_callbacks:
            for hanlder in self.event_callbacks[event]:
                hanlder(event, data)

    # 触发事件
    def emit(self, event: str, data: dict) -> None:
        self.signal.emit(event, data)

    # 订阅事件
    def subscribe(self, event: str, hanlder: Callable) -> None:
        if callable(hanlder):
            self.event_callbacks.setdefault(event, []).append(hanlder)

    # 取消订阅事件
    def unsubscribe(self, event: str, hanlder: Callable) -> None:
        if event in self.event_callbacks:
            self.event_callbacks[event].remove(hanlder)