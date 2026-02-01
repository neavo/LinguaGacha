import asyncio
import threading
import time
from typing import Callable
from typing import Optional


class TaskLimiter:
    def __init__(self, rps: int, rpm: int, max_concurrency: int = 0) -> None:
        self.rps = rps
        self.rpm = rpm
        self.max_capacity = self.calculate_max_capacity()
        self.rate_per_second = self.calculate_stricter_rate()
        self.current_capacity = self.max_capacity
        self.last_request_time = time.time()

        # 使用 BoundedSemaphore 避免 release 失配导致并发上限“被抬高”。
        self.semaphore = (
            asyncio.BoundedSemaphore(max_concurrency) if max_concurrency > 0 else None
        )
        self.max_concurrency = max_concurrency
        self.in_use_concurrency = 0
        self.in_use_concurrency_lock = threading.Lock()
        self.bucket_lock = asyncio.Lock()

    def calculate_max_capacity(self) -> float:
        return min(
            self.rps if self.rps > 0 else float("inf"),
            self.rpm / 60 if self.rpm > 0 else float("inf"),
        )

    def calculate_stricter_rate(self) -> float:
        return min(
            self.rps if self.rps > 0 else float("inf"),
            self.rpm / 60 if self.rpm > 0 else float("inf"),
        )

    async def acquire(self, stop_checker: Optional[Callable[[], bool]] = None) -> bool:
        if self.semaphore is None:
            if stop_checker is not None and stop_checker():
                return False
            with self.in_use_concurrency_lock:
                self.in_use_concurrency += 1
            return True

        while True:
            if stop_checker is not None and stop_checker():
                return False
            try:
                await asyncio.wait_for(self.semaphore.acquire(), timeout=0.1)
                with self.in_use_concurrency_lock:
                    self.in_use_concurrency += 1
                return True
            except asyncio.TimeoutError:
                continue

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

    async def wait(self, stop_checker: Optional[Callable[[], bool]] = None) -> bool:
        if self.max_capacity == float("inf") or self.rate_per_second == float("inf"):
            return True

        while True:
            if stop_checker is not None and stop_checker():
                return False

            async with self.bucket_lock:
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

            await asyncio.sleep(min(wait_time, 0.25))
