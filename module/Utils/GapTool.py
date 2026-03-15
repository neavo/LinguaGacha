"""GIL 间隙工具（GILGapTool）。

用于在长时间的 Python 迭代/循环中，按固定时间间隔短暂 sleep，
给解释器/操作系统调度一个“间隙”，避免单个线程长时间占用 GIL
导致 UI 掉帧或其他线程饥饿。

设计取舍：
- 不做计次数节流（避免不同 iterable 形态导致“每 N 次”的体感差异）。
- 仅按时间间隔插入一次极短 sleep；默认 100ms 是在“响应性/开销”之间的折中。
- Windows 下 sleep(0) 可能不稳定让出时间片，因此默认使用极小 sleep 值。
"""

import sys
import time
from collections.abc import Iterable
from collections.abc import Iterator
from typing import TypeVar

T = TypeVar("T")


class GapTool:
    """避免长循环独占 GIL，给其他线程/GUI 留出调度机会。"""

    DEFAULT_GAP_INTERVAL_SECONDS = 0.1
    DEFAULT_SLEEP_SECONDS = 0.0
    DEFAULT_SLEEP_SECONDS_WINDOWS = 0.001

    @classmethod
    def iter(
        cls,
        iterable: Iterable[T],
        *,
        sleep_seconds: float | None = None,
    ) -> Iterator[T]:
        actual_sleep_seconds = cls.resolve_sleep_seconds(sleep_seconds)

        last_gap_time = time.perf_counter()
        for item in iterable:
            now = time.perf_counter()
            if now - last_gap_time >= cls.DEFAULT_GAP_INTERVAL_SECONDS:
                # 定期让出时间片，降低长循环对 UI 的阻塞
                time.sleep(actual_sleep_seconds)
                last_gap_time = time.perf_counter()

            yield item

    @classmethod
    def resolve_sleep_seconds(cls, sleep_seconds: float | None) -> float:
        if sleep_seconds is not None:
            return max(0.0, float(sleep_seconds))

        if sys.platform == "win32":
            # Windows 下 Sleep(0) 可能不让出时间片，用极小值更稳定
            return cls.DEFAULT_SLEEP_SECONDS_WINDOWS

        return cls.DEFAULT_SLEEP_SECONDS
