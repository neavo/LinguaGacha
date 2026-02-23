# Threading Tests

> This document covers thread-based concurrency tests only. For `asyncio` tests, use `pytest-asyncio`.

## Mock Thread Creation

```python
@patch("threading.Thread")
def test_background_task_started(mock_thread_cls):
    mock_thread = MagicMock()
    mock_thread_cls.return_value = mock_thread
    start_background_task()
    mock_thread_cls.assert_called_once()
    mock_thread.start.assert_called_once()
```

## Test Actual Thread Execution

```python
def test_thread_completes():
    result = []
    def task():
        result.append("done")
    thread = threading.Thread(target=task)
    thread.start()
    thread.join(timeout=1.0)
    assert not thread.is_alive(), "Thread did not complete"
    assert result == ["done"]
```

## Synchronization with Event

```python
def test_threaded_callback():
    completed = threading.Event()
    results = []
    def on_complete(data):
        results.append(data)
        completed.set()
    start_background_operation(callback=on_complete)
    assert completed.wait(timeout=5.0), "Timed out"
    assert results[0]["status"] == "success"
```

## Test Event-Driven Updates

```python
def test_progress_updates():
    updates = []
    done = threading.Event()
    def on_progress(value):
        updates.append(value)
        if value == 100:
            done.set()
    with patch("module.events.emit_progress", side_effect=on_progress):
        start_long_operation()
        assert done.wait(timeout=5.0), "Timed out"
    assert 100 in updates
```

## Avoiding Flaky Tests

```python
# ❌ Race condition
def test_flaky():
    start_background()
    assert get_result() is not None  # May not be ready

# ✅ Explicit synchronization
def test_stable():
    done = threading.Event()
    start_background(on_done=lambda: done.set())
    assert done.wait(timeout=5.0), "Timed out"
    assert get_result() is not None
```

## Thread Pool

```python
def test_concurrent_processing():
    results = []
    lock = threading.Lock()
    def process(item):
        with lock:
            results.append(item * 2)
    with ThreadPoolExecutor(max_workers=3) as executor:
        executor.map(process, [1, 2, 3])
    assert sorted(results) == [2, 4, 6]
```
