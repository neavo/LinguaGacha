import threading
import time
from typing import Callable


class TaskLimiter:
    def __init__(self, rps: int, rpm: int, max_concurrency: int = 0) -> None:
        self.rps = int(rps)
        self.rpm = int(rpm)

        self.max_capacity = self.calculate_max_capacity()
        self.rate_per_second = self.calculate_stricter_rate()
        self.current_capacity = self.max_capacity
        self.last_request_time = time.time()

        # 使用 BoundedSemaphore 避免 release 失配导致并发上限“被抬高”。
        self.semaphore: threading.BoundedSemaphore | None = (
            threading.BoundedSemaphore(max_concurrency) if max_concurrency > 0 else None
        )
        self.max_concurrency = int(max_concurrency)

        self.in_use_concurrency = 0
        self.in_use_concurrency_lock = threading.Lock()

        # 令牌桶必须线程安全。
        self.bucket_lock = threading.Lock()

    def calculate_max_capacity(self) -> float:
        # 这里的“令牌”表示“请求许可”。每次请求消耗 1 个令牌。
        # 当 rpm < 60 时，rate_per_second 会小于 1；如果桶容量也被钳制到 < 1，
        # 则 current_capacity 永远无法累计到 >= 1，wait() 会进入永久等待。
        stricter_rate = self.calculate_stricter_rate()
        if stricter_rate == float("inf"):
            return float("inf")
        return max(1.0, stricter_rate)

    def calculate_stricter_rate(self) -> float:
        return min(
            self.rps if self.rps > 0 else float("inf"),
            self.rpm / 60 if self.rpm > 0 else float("inf"),
        )

    def acquire(self, stop_checker: Callable[[], bool] | None = None) -> bool:
        if self.semaphore is None:
            if stop_checker is not None and stop_checker():
                return False
            with self.in_use_concurrency_lock:
                self.in_use_concurrency += 1
            return True

        while True:
            if stop_checker is not None and stop_checker():
                return False
            acquired = self.semaphore.acquire(timeout=0.1)
            if not acquired:
                continue
            with self.in_use_concurrency_lock:
                self.in_use_concurrency += 1
            return True

    def release(self) -> None:
        if self.semaphore is not None:
            self.semaphore.release()
        with self.in_use_concurrency_lock:
            if self.in_use_concurrency > 0:
                self.in_use_concurrency -= 1

    def get_concurrency_in_use(self) -> int:
        with self.in_use_concurrency_lock:
            return self.in_use_concurrency

    def get_concurrency_limit(self) -> int:
        return max(0, int(self.max_concurrency))

    def wait(self, stop_checker: Callable[[], bool] | None = None) -> bool:
        if self.max_capacity == float("inf") or self.rate_per_second == float("inf"):
            return True

        while True:
            if stop_checker is not None and stop_checker():
                return False

            with self.bucket_lock:
                now = time.time()
                elapsed_time = now - self.last_request_time

                # 恢复额度
                self.current_capacity = min(
                    self.max_capacity,
                    self.current_capacity + elapsed_time * self.rate_per_second,
                )
                self.last_request_time = now

                if self.current_capacity >= 1:
                    self.current_capacity = self.current_capacity - 1
                    return True

                wait_time = (1 - self.current_capacity) / self.rate_per_second

            time.sleep(min(wait_time, 0.25))
