import threading
from typing import Self

from base.Base import Base

class Engine():

    TASK_PREFIX: str = "ENGINE_"

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.status: Base.TaskStatus = Base.TaskStatus.IDLE

        # 线程锁
        self.lock = threading.Lock()

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__

    def run(self) -> None:
        from module.Engine.APITester.APITester import APITester
        self.api_test = APITester()

        from module.Engine.Translator.Translator import Translator
        self.translator = Translator()

    def get_status(self) -> Base.TaskStatus:
        with self.lock:
            return self.status

    def set_status(self, status: Base.TaskStatus) -> None:
        with self.lock:
            self.status = status

    def get_running_task_count(self) -> int:
        return sum(1 for t in threading.enumerate() if t.name.startswith(__class__.TASK_PREFIX))