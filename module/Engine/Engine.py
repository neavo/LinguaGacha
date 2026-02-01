import threading
from typing import Callable
from typing import Self

from base.Base import Base
from model.Item import Item
from module.Config import Config


class Engine:
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
        # 线程池线程常驻：用真实并发数（占用 limiter 的任务数）避免 UI 虚高。
        count = 0

        translator = getattr(self, "translator", None)
        if translator is not None:
            count += translator.get_concurrency_in_use()

        single_task_name = f"{self.TASK_PREFIX}SINGLE"
        count += sum(1 for t in threading.enumerate() if t.name == single_task_name)
        return count

    def translate_single_item(
        self, item: Item, config: Config, callback: Callable[[Item, bool], None]
    ) -> None:
        """
        对单个条目执行翻译，异步返回结果。
        复用 TranslatorTask 的完整翻译流程（预处理、响应校验、日志等）。

        Args:
            item: 待翻译的 Item 对象
            config: 翻译配置
            callback: 翻译完成后的回调函数，签名为 (item, success) -> None
        """
        # 延迟导入避免循环依赖
        from module.Engine.Translator.TranslatorTask import TranslatorTask

        TranslatorTask.translate_single(item, config, callback)
