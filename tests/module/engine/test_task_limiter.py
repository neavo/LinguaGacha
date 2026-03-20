from __future__ import annotations

import pytest

import module.Engine.TaskLimiter as task_limiter_module
from module.Engine.TaskLimiter import TaskLimiter


class FakeSemaphore:
    def __init__(self, acquire_results: list[bool]) -> None:
        self.acquire_results = acquire_results
        self.acquire_calls = 0
        self.release_calls = 0

    def acquire(self, timeout: float) -> bool:
        del timeout
        self.acquire_calls += 1
        if self.acquire_results:
            return self.acquire_results.pop(0)
        return True

    def release(self) -> None:
        self.release_calls += 1


def test_calculate_stricter_rate_prefers_more_strict_limit() -> None:
    limiter = TaskLimiter(rps=10, rpm=120)
    assert limiter.calculate_stricter_rate() == pytest.approx(2.0)


def test_calculate_max_capacity_is_at_least_one_for_low_rate() -> None:
    limiter = TaskLimiter(rps=0, rpm=30)
    assert limiter.calculate_max_capacity() == 1.0


def test_acquire_without_semaphore_respects_stop_checker() -> None:
    limiter = TaskLimiter(rps=1, rpm=60, max_concurrency=0)

    stopped = limiter.acquire(lambda: True)
    acquired = limiter.acquire()

    assert stopped is False
    assert acquired is True
    assert limiter.get_concurrency_in_use() == 1

    limiter.release()
    assert limiter.get_concurrency_in_use() == 0


def test_acquire_with_semaphore_retries_until_success() -> None:
    limiter = TaskLimiter(rps=1, rpm=60, max_concurrency=1)
    fake_semaphore = FakeSemaphore([False, True])
    setattr(limiter, "semaphore", fake_semaphore)

    acquired = limiter.acquire()

    assert acquired is True
    assert fake_semaphore.acquire_calls == 2
    assert limiter.get_concurrency_in_use() == 1

    limiter.release()
    assert fake_semaphore.release_calls == 1
    assert limiter.get_concurrency_in_use() == 0


def test_acquire_with_semaphore_returns_false_when_stop_requested() -> None:
    limiter = TaskLimiter(rps=1, rpm=60, max_concurrency=1)

    assert limiter.acquire(lambda: True) is False
    assert limiter.get_concurrency_in_use() == 0


def test_wait_returns_false_when_stop_requested() -> None:
    limiter = TaskLimiter(rps=1, rpm=60)
    limiter.current_capacity = 0
    result = limiter.wait(lambda: True)
    assert result is False


def test_wait_sleeps_then_succeeds_after_refill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limiter = TaskLimiter(rps=1, rpm=0)
    limiter.current_capacity = 0
    limiter.last_request_time = 0.0

    times = iter([0.1, 1.1])
    sleep_calls: list[float] = []

    monkeypatch.setattr(task_limiter_module.time, "time", lambda: next(times))
    monkeypatch.setattr(
        task_limiter_module.time, "sleep", lambda value: sleep_calls.append(value)
    )

    assert limiter.wait() is True
    assert sleep_calls == [0.25]
    assert limiter.current_capacity == pytest.approx(0.0)


def test_wait_returns_true_immediately_when_unlimited() -> None:
    limiter = TaskLimiter(rps=0, rpm=0)
    assert limiter.wait() is True


def test_release_keeps_zero_when_no_concurrency_in_use() -> None:
    limiter = TaskLimiter(rps=1, rpm=60, max_concurrency=0)

    limiter.release()

    assert limiter.get_concurrency_in_use() == 0


def test_get_concurrency_limit_clamps_negative_to_zero() -> None:
    limiter = TaskLimiter(rps=1, rpm=60, max_concurrency=1)
    limiter.max_concurrency = -5

    assert limiter.get_concurrency_limit() == 0
