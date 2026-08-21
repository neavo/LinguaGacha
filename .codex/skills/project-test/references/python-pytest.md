# Python / pytest

只在任务涉及 Python 或 pytest 时读取本文件。以下只补充 pytest、Python 文件系统和并发的特有做法。

## 基本形状

```python
def test_checkout_returns_completed_order() -> None:
    cart = Cart(items=[Item("book", 25)])
    payment = FakePaymentGateway(success=True)

    result = checkout(cart, payment)

    assert result.status == "completed"
    assert result.total == 25
```

仅在准备过程较复杂时保留 `Arrange / Act / Assert` 注释。

## 按测试目的选择边界

|要证明的内容|优先做法|
|---|---|
|纯规则、转换、校验|直接运行真实函数|
|文件路径、编码、重命名等真实语义|使用 pytest `tmp_path`|
|大量文件操作且项目已使用 `pyfakefs`|使用 `fs`，并确认其行为足以代表目标平台|
|SQLite 仓储语义|使用 `:memory:` 或测试数据库并清理连接|
|HTTP、云 SDK、消息系统|fake client 或 patch 使用点，不访问真实服务|
|时间、随机数、ID|注入来源或 patch 使用点|
|线程、任务队列|等待明确完成信号，不依赖固定睡眠|

## 文件系统

需要真实文件系统语义时，`tmp_path` 通常最直接：

```python
def test_save_summary_writes_json(tmp_path: Path) -> None:
    output = tmp_path / "summary.json"

    save_summary(output, {"completed": 2})

    assert json.loads(output.read_text(encoding="utf-8")) == {"completed": 2}
```

如果业务层已有内存适配器，且测试不关心操作系统语义，优先使用它。

## Mock 与 fake

对外部边界使用窄 fake 往往比深层 mock 更易读：

```python
class FakeJobClient:
    def submit(self, payload: dict[str, str]) -> str:
        assert payload == {"text": "hello"}
        return "job-1"


def test_queue_job_returns_public_status() -> None:
    result = queue_job("hello", client=FakeJobClient())

    assert result == {"status": "queued", "job_id": "job-1"}
```

必须 patch 时 patch 使用点，并在主要结果断言之后补充真正属于契约的调用约束。

## 并发与后台任务

对线程和队列使用带超时的完成信号：
```python
def test_worker_publishes_result() -> None:
    results: queue.Queue[str] = queue.Queue()
    worker = threading.Thread(target=lambda: results.put("done"))
    worker.start()
    assert results.get(timeout=1.0) == "done"
    worker.join(timeout=1.0)
    assert not worker.is_alive()
```

## 夹具组织

- 默认使用函数级作用域；只有昂贵且不会泄漏状态的资源才扩大作用域。
- fixture 或工厂为每个测试返回新对象，并把业务断言留在测试正文。

## 验证

先读取 `pyproject.toml`、`pytest.ini`、`tox.ini`、`noxfile.py`、任务脚本或 CI 配置。只运行项目实际支持的命令，例如：

```text
pytest path/to/test_module.py
uv run pytest path/to/test_module.py
ruff check
ruff format --check
```

把 `--fix` 或格式化写入作为实施动作，而不是只读验证。
