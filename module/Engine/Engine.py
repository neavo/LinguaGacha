import threading
from typing import Callable
from typing import Self

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config


class Engine:
    TASK_PREFIX: str = "ENGINE_"

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.status: Base.TaskStatus = Base.TaskStatus.IDLE

        # 正在发送请求的任务数（不包含限速等待）
        self.request_in_flight_count: int = 0
        self.request_in_flight_lock = threading.Lock()

        # 线程锁
        self.lock = threading.Lock()

    @classmethod
    def get(cls) -> Self:
        if not hasattr(cls, "__instance__"):
            cls.__instance__ = cls()

        return cls.__instance__

    def run(self) -> None:
        from module.Engine.APITest.APITest import APITest

        self.api_test = APITest()

        from module.Engine.Analysis.Analysis import Analysis

        self.analysis = Analysis()

        from module.Engine.Translation.Translation import Translation

        self.translation = Translation()

    def get_status(self) -> Base.TaskStatus:
        with self.lock:
            return self.status

    def set_status(self, status: Base.TaskStatus) -> None:
        with self.lock:
            self.status = status

    def inc_request_in_flight(self) -> None:
        with self.request_in_flight_lock:
            self.request_in_flight_count += 1

    def dec_request_in_flight(self) -> None:
        with self.request_in_flight_lock:
            if self.request_in_flight_count > 0:
                self.request_in_flight_count -= 1

    def get_request_in_flight_count(self) -> int:
        with self.request_in_flight_lock:
            return self.request_in_flight_count

    def is_busy(self) -> bool:
        """统一暴露引擎忙碌态，避免上层重复判断枚举。"""

        return Base.is_engine_busy(self.get_status())

    def get_active_task_type(self) -> str:
        """把引擎运行状态映射为当前活跃任务类型。"""

        status = self.get_status()
        if status == Base.TaskStatus.TRANSLATING:
            return "translation"
        if status == Base.TaskStatus.ANALYZING:
            return "analysis"
        return "idle"

    def get_running_task_count(self) -> int:
        # 后台任务数（用于 busy 判断）：包含占用 limiter 的并发与单条翻译线程。
        # UI 需要“实时请求数”时使用 get_request_in_flight_count()。
        count = 0

        for worker_name in ("translation", "analysis"):
            worker = getattr(self, worker_name, None)
            if worker is not None:
                count += worker.get_concurrency_in_use()

        single_task_name = f"{self.TASK_PREFIX}SINGLE"
        count += sum(1 for t in threading.enumerate() if t.name == single_task_name)
        return count

    def translate_single_item(
        self, item: Item, config: Config, callback: Callable[[Item, bool], None]
    ) -> None:
        """
        对单个条目执行翻译，通过后台线程 + 回调异步返回结果。
        复用 TranslationTask 的完整翻译流程（预处理、响应校验、日志等）。

        Args:
            item: 待翻译的 Item 对象
            config: 翻译配置
            callback: 翻译完成后的回调函数，签名为 (item, success) -> None
        """
        # 延迟导入避免循环依赖
        from module.Engine.Translation.TranslationTask import TranslationTask

        TranslationTask.translate_single(item, config, callback)
