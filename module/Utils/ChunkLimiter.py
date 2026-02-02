import sys
import time
from collections.abc import Iterable
from collections.abc import Iterator
from typing import TypeVar

T = TypeVar("T")


class ChunkLimiter:
    DEFAULT_EVERY = 64
    DEFAULT_MIN_INTERVAL = 0.05
    DEFAULT_SLEEP_SECONDS = 0.0
    DEFAULT_SLEEP_SECONDS_WINDOWS = 0.001

    @classmethod
    def iter(
        cls,
        iterable: Iterable[T],
        *,
        every: int | None = None,
        min_interval: float | None = None,
        sleep_seconds: float | None = None,
    ) -> Iterator[T]:
        actual_every = cls.DEFAULT_EVERY if every is None else every
        if actual_every <= 0:
            yield from iterable
            return

        actual_min_interval = (
            cls.DEFAULT_MIN_INTERVAL
            if min_interval is None
            else max(0.0, float(min_interval))
        )
        actual_sleep_seconds = cls.resolve_sleep_seconds(sleep_seconds)

        counter = 0
        last_yield_time = 0.0
        for item in iterable:
            counter += 1
            if counter % actual_every == 0:
                now = time.perf_counter()
                if (
                    last_yield_time <= 0.0
                    or actual_min_interval <= 0.0
                    or now - last_yield_time >= actual_min_interval
                ):
                    # 定期让出时间片，降低长循环对 UI 的阻塞
                    time.sleep(actual_sleep_seconds)
                    last_yield_time = time.perf_counter()

            yield item

    @classmethod
    def resolve_sleep_seconds(cls, sleep_seconds: float | None) -> float:
        if sleep_seconds is not None:
            return max(0.0, float(sleep_seconds))

        if sys.platform == "win32":
            # Windows 下 Sleep(0) 可能不让出时间片，用极小值更稳定
            return cls.DEFAULT_SLEEP_SECONDS_WINDOWS

        return cls.DEFAULT_SLEEP_SECONDS
