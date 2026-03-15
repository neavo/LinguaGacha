# 线程测试

> 这里只讨论基于线程的测试；如果是 `asyncio`，请改用对应的异步测试方案。

## 核心原则

线程测试看公开结果，不看线程构造细节。

- 优先 patch worker 启动入口，让它同步执行
- 优先断言事件、最终状态、日志或公开回调结果
- 如果必须跑真线程，就用明确的完成信号同步
- 不要把 `threading.Thread(target=..., name=..., daemon=...)` 的参数当主要断言

## 把异步入口改成同步

```python
def test_background_job_emits_completed_event():
    events: list[tuple[str, dict[str, str]]] = []

    def run_now(worker):
        worker()

    with patch("module.worker.start_async", side_effect=run_now):
        run_background_job(
            emit=lambda event, payload: events.append((event, payload))
        )

    assert events == [("job.completed", {"status": "ok"})]
```

这类测试最稳，因为它只关心工作完成后的公开结果。

## 跑真实线程时等完成信号

```python
def test_thread_completes():
    finished = threading.Event()
    results: list[str] = []

    def task():
        results.append("done")
        finished.set()

    thread = threading.Thread(target=task)
    thread.start()

    assert finished.wait(timeout=1.0), "线程没有按时完成"
    assert results == ["done"]
```

## 测回调结果

```python
def test_threaded_callback():
    completed = threading.Event()
    results: list[dict[str, str]] = []

    def on_complete(data):
        results.append(data)
        completed.set()

    start_background_operation(callback=on_complete)

    assert completed.wait(timeout=5.0), "等待回调超时"
    assert results[0]["status"] == "success"
```

## 测进度事件

```python
def test_progress_updates():
    updates: list[int] = []
    finished = threading.Event()

    def on_progress(value):
        updates.append(value)
        if value == 100:
            finished.set()

    start_long_operation(on_progress=on_progress)

    assert finished.wait(timeout=5.0), "等待进度完成超时"
    assert updates[-1] == 100
```

## 避免不稳定测试

```python
# ❌ 没同步，容易偶发失败
def test_flaky():
    start_background()
    assert get_result() is not None

# ✅ 等明确完成信号
def test_stable():
    done = threading.Event()
    start_background(on_done=lambda: done.set())

    assert done.wait(timeout=5.0), "等待后台任务超时"
    assert get_result() is not None
```

## 线程池

```python
def test_concurrent_processing():
    results: list[int] = []
    lock = threading.Lock()

    def process(item):
        with lock:
            results.append(item * 2)

    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(process, [1, 2, 3]))

    assert sorted(results) == [2, 4, 6]
```
