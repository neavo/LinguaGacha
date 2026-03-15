# 边界 Mock 模式

## 总原则

Mock 是拿来隔离外部边界的，不是拿来把业务逻辑掏空的。

- 优先 mock 网络、外部 SDK、系统接口、时间、随机数
- 集成测试和场景测试里，不要把同仓库内部模块一层层全 mock 掉
- 先断言业务结果，再把 mock 调用断言当补充校验
- 一律 patch 在使用点，不 patch 在定义点

## Mock HTTP 请求

```python
@patch("module.api.httpx.Client.post")
def test_api_call(mock_post):
    mock_post.return_value = MagicMock(
        status_code=200,
        json=lambda: {"result": "success"},
    )

    result = call_api()

    assert result == {"result": "success"}
    mock_post.assert_called_once_with(
        "https://api.example.com/data",
        json={"key": "value"},
    )
```

## 文件系统隔离

文件系统优先用 `fs`，不要优先想 `mock_open`。

```python
def test_read_file(fs):
    path = Path("/workspace/config.json")
    path.write_text('{"k": "v"}', encoding="utf-8")

    result = read_config(path)

    assert result["k"] == "v"
```

```python
def test_reads_real_template_file(fs):
    fs.add_real_file("resource/preset/template.txt", read_only=True)
    assert load_template("resource/preset/template.txt")
```

## 数据库边界

```python
def test_with_in_memory_db():
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE items (id INTEGER, name TEXT)")
    connection.execute("INSERT INTO items VALUES (1, 'test')")

    with patch("module.db.get_connection", return_value=connection):
        result = query_items()

    assert len(result) == 1
```

如果能直接跑真实的内存数据库，就别把数据库行为整个 fake 掉。

## 单例或配置

```python
@patch("module.config.Config.get")
def test_with_config(mock_get):
    config = MagicMock()
    config.api_key = "test-key"
    mock_get.return_value = config

    result = function_using_config()

    assert result == "expected"
```

## 外部 SDK

```python
@patch("openai.OpenAI")
def test_llm_call(mock_client_class):
    client = MagicMock()
    mock_client_class.return_value = client
    completion = MagicMock()
    completion.choices = [MagicMock(message=MagicMock(content="response"))]
    client.chat.completions.create.return_value = completion

    result = call_llm("prompt")

    assert result == "response"
```

## patch 在使用点

```python
# module/service.py 里写的是：from module.utils import helper

# ✅ patch 在真正被调用的地方
@patch("module.service.helper")

# ❌ patch 在定义点
@patch("module.utils.helper")
```

## 结果优先，调用断言靠后

```python
@patch("module.api.post")
def test_posts_processed_payload(mock_post):
    result = call_api({"data": "value"})

    assert result["status"] == "queued"
    mock_post.assert_called_once_with(
        "https://api.example.com",
        json={"data": "value"},
    )
```

不要这样写：

```python
assert mock_post.call_args.kwargs["json"]["data"] == "value"
```

这种写法太靠实现细节，应该优先看返回结果、事件载荷或持久化结果。

## 记录公开事件而不是内部状态

```python
def test_emits_public_event():
    events: list[tuple[str, dict[str, str]]] = []

    event_bus = SimpleNamespace(
        emit=lambda event, payload: events.append((event, payload))
    )

    process_job(event_bus)

    assert events == [("job.completed", {"status": "ok"})]
```

## 异常边界

```python
@patch("module.api.fetch")
def test_handles_timeout(mock_fetch):
    mock_fetch.side_effect = TimeoutError("connection timeout")

    with pytest.raises(ServiceError, match="timeout"):
        call_api()
```
