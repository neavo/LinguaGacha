# 测试反模式

## 先看一个总判断

如果断言回答的是“内部是不是刚好这样写”，这大概率就是坏味道；如果断言回答的是“用户能看到的结果对不对”，这才是正路。

优先断言这些公开结果：

- 返回值和异常
- 最终状态和可读取快照
- 公开事件和回调载荷
- 文件内容、数据库记录、持久化结果

## 命名含糊

```python
# ❌ 看不出在测什么
def test_func1(): ...
def test_it_works(): ...

# ✅ 直接写清业务意图
def test_returns_empty_list_when_input_is_none(): ...
def test_raises_value_error_for_negative_amount(): ...
```

## 测试数据没语义

```python
# ❌ 只是随手凑值
def test_user():
    user = create_user("aaa", "bbb", 123)
    assert user.is_valid()

# ✅ 数据本身就说明场景
def test_user_accepts_valid_email():
    user = create_user(name="John Doe", email="john@example.com", age=25)
    assert user.is_valid()

def test_user_rejects_invalid_email():
    user = create_user(name="John Doe", email="not-an-email", age=25)
    assert not user.is_valid()
```

## 无意义断言

```python
# ❌ 证明不了业务
assert obj is not None
assert len([1, 2, 3]) == 3
assert calculate_total([1, 2, 3]) == sum([1, 2, 3])

# ✅ 直接测需求
def test_returns_zero_for_empty_list():
    assert calculate_total([]) == 0

def test_handles_negative_values():
    assert calculate_total([-5, 10]) == 5
```

## 盯内部实现

```python
# ❌ 看私有缓存
def test_cache_internal():
    service = CacheService(source=lambda key: "value")
    service.get("key")
    assert "key" in service.cache_dict

# ❌ 只看内部调用细节
def test_updates_via_mock_call_args():
    service = MagicMock()
    run_job(service)
    assert service.save.call_args.kwargs["status"] == "done"

# ✅ 记录公开结果快照
def test_records_completed_job():
    saved_jobs: list[dict[str, str]] = []

    repository = SimpleNamespace(
        save=lambda **kwargs: saved_jobs.append(kwargs)
    )

    run_job(repository)

    assert saved_jobs == [{"status": "done", "result": "ok"}]
```

## 半成品对象

```python
# ❌ 跳过正常初始化
service = Service.__new__(Service)
service.client = MagicMock()
service.cache = {}

# ✅ 真实构造对象，只隔离副作用边界
with patch("module.service.ExternalClient") as mock_client:
    mock_client.return_value.fetch.return_value = {"status": "ok"}
    service = Service()
```

不要用 `Class.__new__(Class)` 或手工塞属性去拼一个“看起来能跑”的实例。优先走真实构造，再 patch 网络、线程、事件订阅这类副作用边界。

## Mock 用错地方

```python
# ❌ patch 在定义点
@patch("module.utils.helper")

# ✅ patch 在使用点
@patch("module.service.helper")
```

## 只看 mock 调用，不看结果

```python
# ❌ 只证明外部函数被调了
@patch("module.api.send")
def test_sends_data(mock_send):
    process_and_send({"id": 1})
    mock_send.assert_called_once()

# ✅ 先证明业务结果，再补边界校验
@patch("module.api.send")
def test_sends_processed_payload(mock_send):
    result = process_and_send({"id": 1})

    assert result["status"] == "queued"
    mock_send.assert_called_once_with({"id": 1, "state": "ready"})
```

## 文件隔离做歪了

```python
# ❌ 依赖磁盘临时目录
def test_write(tmp_path):
    path = tmp_path / "out.txt"
    save(path)

# ✅ 用 pyfakefs 统一隔离
def test_write(fs):
    path = Path("/workspace/out.txt")
    save(path)
    assert path.read_text(encoding="utf-8") == "done"
```

```python
# ❌ 只 patch open，覆盖不全
with patch("builtins.open", mock_open(read_data="x")):
    load()

# ✅ 用 fs 一次接住 Path/open/os/shutil/glob
def test_load(fs):
    path = Path("/workspace/data.txt")
    path.write_text("x", encoding="utf-8")
    assert load(path) == "x"
```

新增测试不要再用 `tmp_path`、`tempfile`、`mock_open`。

## 测试互相污染

```python
# ❌ 依赖执行顺序
class TestOrdered:
    shared_state = []

    def test_first(self):
        self.shared_state.append(1)

    def test_second(self):
        assert self.shared_state == [1]

# ✅ 每个测试都自给自足
def test_first():
    state = [1]
    assert state == [1]
```

```python
# ❌ 返回共享可变对象
@pytest.fixture
def shared_list():
    return global_list

# ✅ 返回新对象
@pytest.fixture
def items():
    return [1, 2, 3]
```

## 时间相关测试不受控

```python
# ❌ 靠当前时间碰运气
def test_expiry():
    token = create_token()
    assert not token.is_expired()

# ✅ 显式控制时间
@patch("module.auth.datetime")
def test_expiry(mock_datetime):
    mock_datetime.now.return_value = datetime(2024, 1, 1, 12, 0)
    token = create_token()
    assert not token.is_expired()
```

## 覆盖率陷阱

```python
# ❌ 只有快乐路径
def test_process():
    assert process(valid_data) == expected

# ✅ 把边界和错误分支补齐
def test_process_valid():
    assert process(valid_data) == expected

def test_process_empty():
    assert process([]) == []

def test_process_invalid_raises():
    with pytest.raises(ValueError):
        process(None)
```

## 旧白盒测试整改顺序

1. 先扫：`rg -n "__new__|call_args|call_args_list|tmp_path|mock_open" tests`
2. 说清这个测试到底要证明什么业务行为
3. 把内部调用断言换成结果快照、事件序列或持久化断言
4. 把重复准备逻辑收进最近的 `conftest.py`
5. 能用内存数据库和虚拟文件系统，就别再手造假的系统壳