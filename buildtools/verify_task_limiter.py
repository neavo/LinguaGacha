import asyncio
import pathlib
import sys
import time

repo_root_path = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root_path))


async def verify_concurrency_only() -> None:
    from module.Engine.TaskLimiter import TaskLimiter

    limiter = TaskLimiter(rps=0, rpm=0, max_concurrency=5)

    max_seen = 0
    lock = asyncio.Lock()

    async def worker() -> None:
        nonlocal max_seen
        acquired = await limiter.acquire()
        if not acquired:
            return

        try:
            async with lock:
                max_seen = max(max_seen, limiter.get_concurrency_in_use())
            await asyncio.sleep(0.05)
        finally:
            limiter.release()

    await asyncio.gather(*(worker() for _ in range(50)))

    if max_seen > 5:
        raise AssertionError(f"并发上限失效：max_seen={max_seen} > 5")


async def verify_rps_bucket() -> None:
    from module.Engine.TaskLimiter import TaskLimiter

    # token bucket 允许初始 burst=rps；此处用总耗时下界做一个粗验证。
    limiter = TaskLimiter(rps=5, rpm=0, max_concurrency=100)

    async def worker() -> None:
        acquired = await limiter.acquire()
        if not acquired:
            return
        try:
            waited = await limiter.wait()
            if not waited:
                return
        finally:
            limiter.release()

    start = time.perf_counter()
    await asyncio.gather(*(worker() for _ in range(20)))
    elapsed = time.perf_counter() - start

    # 20 次请求，初始 burst=5，剩余 15 次按 5 rps 需要 >=3s。
    if elapsed < 2.6:
        raise AssertionError(f"RPS 限流可能失效：elapsed={elapsed:.2f}s < 2.6s")


def main() -> None:
    asyncio.run(verify_concurrency_only())
    asyncio.run(verify_rps_bucket())
    print("verify_task_limiter: OK")


if __name__ == "__main__":
    main()
