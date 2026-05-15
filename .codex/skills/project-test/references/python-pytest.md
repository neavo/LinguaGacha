# Python pytest 示例

只在任务涉及 Python service、领域逻辑、数据访问、文件系统、线程或 pytest 夹具时读取本文件。

## 基本形状

```python
def test_user_can_checkout_with_valid_cart() -> None:
    # Arrange
    cart = Cart(items=[Item("book", 25)])
    payment = FakePaymentGateway(success=True)

    # Act
    result = checkout(cart, payment)

    # Assert
    assert result.status == "completed"
    assert result.total == 25
```

规则：
- 测试函数标注 `-> None`。
- 注释只在复杂准备阶段使用，优先解释约束原因。
- 测试名直接描述业务结果。
- 遵守“一业务文件一测试文件”：例如 `order_service.py` 只对应 `test_order_service.py`。

## 异常与参数化

```python
def test_rejects_negative_amount() -> None:
    with pytest.raises(ValueError, match="must be positive"):
        transfer(amount=-100)
```

```python
@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, "zero"), (1, "positive"), (-1, "negative")],
)
def test_classify_number(value: int, expected: str) -> None:
    assert classify_number(value) == expected
```

只在“同一种行为，不同输入”时参数化；如果是不同业务语义，就拆成多个测试。

## 文件系统

文件系统优先使用 `pyfakefs` 的 `fs`，不要新增 `tmp_path`、`tempfile`、`mock_open`。

```python
def test_write_project_summary(fs) -> None:
    path = Path("/workspace/project/summary.json")

    save_summary(path, {"done": 2})

    assert json.loads(path.read_text(encoding="utf-8")) == {"done": 2}
```

读取真实模板时用 `fs.add_real_file()`：

```python
def test_loads_builtin_template(fs) -> None:
    fs.add_real_file("resource/preset/template.txt", read_only=True)

    assert load_template("resource/preset/template.txt") != ""
```

## SQLite 与持久化

能跑真实内存数据库，就不要把数据库行为整个 mock 掉。

```python
def test_repository_returns_saved_item() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE items (id INTEGER, name TEXT)")

    repository = ItemRepository(connection)
    repository.save(item_id=1, name="chapter01")

    assert repository.list_items() == [{"id": 1, "name": "chapter01"}]
```

## Service 场景

跨 service 的场景测试只 mock 外部边界，内部数据流保持真实。

```python
def test_publish_public_update_event() -> None:
    service = EventStreamService(event_bridge=bridge)
    subscriber = service.add_subscriber()

    service.publish_domain_event(
        "record.saved",
        {
            "source": "mutation",
            "updatedSections": ["records"],
            "operations": [{"op": "merge_records", "records": [{"id": 1}]}],
            "revision": 9,
        },
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "state.updated"
    assert envelope.data["updatedSections"] == ["records"]
    assert envelope.data["operations"][0]["records"][0]["id"] == 1
```

## Mock 外部边界

Mock 用来隔离网络、外部 SDK、系统接口、时间、随机数。先断言业务结果，再把调用断言作为补充。

```python
@patch("module.service.httpx.Client.post")
def test_posts_processed_payload(mock_post) -> None:
    mock_post.return_value = SimpleNamespace(
        status_code=200,
        json=lambda: {"job_id": "job-1"},
    )

    result = queue_job({"text": "原文"})

    assert result == {"status": "queued", "job_id": "job-1"}
    mock_post.assert_called_once_with(
        "https://api.example.com/jobs",
        json={"text": "原文", "state": "ready"},
    )
```

注意 patch 在使用点，不 patch 在定义点。

## 线程与后台任务

线程测试看公开结果，不看 `threading.Thread(...)` 的构造参数。

```python
def test_background_job_emits_completed_event() -> None:
    events: list[tuple[str, dict[str, str]]] = []

    def run_now(worker):
        worker()

    with patch("module.worker.start_async", side_effect=run_now):
        run_background_job(
            emit=lambda event, payload: events.append((event, payload))
        )

    assert events == [("job.completed", {"status": "ok"})]
```

必须跑真线程时，等待明确完成信号：

```python
def test_thread_completes() -> None:
    finished = threading.Event()
    results: list[str] = []

    def task() -> None:
        results.append("done")
        finished.set()

    thread = threading.Thread(target=task)
    thread.start()

    assert finished.wait(timeout=1.0), "线程没有按时完成"
    assert results == ["done"]
```

## 夹具组织

- 全局通用夹具放 `tests/conftest.py`。
- 领域专用夹具放对应目录下的 `conftest.py`。
- 默认函数级作用域；初始化昂贵且不会污染测试时才扩大作用域。
- 组合夹具要保持可读，别做“什么都塞进去”的魔法夹具。

```python
@pytest.fixture
def in_memory_db() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE items (id INTEGER, name TEXT)")
    yield connection
    connection.close()
```

## 常用验证

```powershell
uv run pytest tests/path/to/test_order_service.py -v
uv run pytest tests/ -v
uv run ruff format
uv run ruff check --fix
```
