import threading
import time
from typing import Callable
from typing import Optional

class TaskLimiter:

    def __init__(self, rps: int, rpm: int, max_concurrency: int = 0) -> None:
        self.rps = rps
        self.rpm = rpm
        self.max_capacity = self._calculate_max_capacity()
        self.rate_per_second = self._calculate_stricter_rate()
        self.current_capacity = self.max_capacity
        self.last_request_time = time.time()

        # 并发控制
        self.semaphore = threading.BoundedSemaphore(max_concurrency) if max_concurrency > 0 else None

    # 计算最大容量
    def _calculate_max_capacity(self) -> float:
        return min(
            self.rps if self.rps > 0 else float("inf"),
            self.rpm / 60 if self.rpm > 0 else float("inf"),
        )

    # 计算每秒恢复的请求额度
    def _calculate_stricter_rate(self) -> float:
        return min(
            self.rps if self.rps > 0 else float("inf"),
            self.rpm / 60 if self.rpm > 0 else float("inf"),
        )

    # 尝试获取并发许可
    def acquire(self, stop_checker: Optional[Callable[[], bool]] = None) -> bool:
        if self.semaphore is None:
            return True

        while not self.semaphore.acquire(timeout = 0.1):
            if stop_checker is not None and stop_checker():
                return False
        return True

    # 释放并发许可
    def release(self, *args) -> None:
        if self.semaphore is not None:
            self.semaphore.release()

    # 等待直到有足够的请求额度
    def wait(self, stop_checker: Optional[Callable[[], bool]] = None) -> bool:
        current_time = time.time()
        elapsed_time = current_time - self.last_request_time

        # 恢复额度
        self.current_capacity = self.current_capacity + elapsed_time * self.rate_per_second
        self.current_capacity = min(self.current_capacity, self.max_capacity)

        # 如果额度不足，等待
        if self.current_capacity < 1:
            wait_time = (1 - self.current_capacity) / self.rate_per_second

            # 分段等待以支持中断
            while wait_time > 0:
                if stop_checker is not None and stop_checker():
                    return False

                sleep_time = min(wait_time, 0.25)
                time.sleep(sleep_time)
                wait_time -= sleep_time

            self.current_capacity = 1

        # 扣减配额
        self.current_capacity = self.current_capacity - 1

        # 更新最后请求时间
        self.last_request_time = time.time()
        return True