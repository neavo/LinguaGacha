# 夹具组织

## 核心原则

夹具离使用位置越近越好，只有真正全局通用的东西才放到 `tests/conftest.py`。

- 全局通用夹具放 `tests/conftest.py`
- 领域专用夹具放对应目录下的 `conftest.py`
- 夹具保持聚焦，别做“什么都包进去”的魔法夹具
- 文件系统优先复用 `fs`
- 数据库优先复用 `:memory:` 连接或对应的内存数据库夹具

## 测试文件组织

夹具离使用位置近，和测试文件可以随便拆散，不是一回事。默认还是要把测试按主被测对象和业务域收拢好。

- 同一业务文件的单元测试默认集中在一个主测试文件中
- 不要无理由把同一被测对象的测试散落到多个目录或多个名称含糊的测试文件里
- 只有当测试层次不同、场景边界明显不同，或单个测试文件已经明显影响可读性时，才拆分到多个测试文件
- 拆分后的文件名要直接说明测试目的
- 拆分后对应的 `conftest.py` 仍然遵守“离使用位置越近越好”

## 基础夹具

```python
# tests/conftest.py
@pytest.fixture
def mock_config():
    with patch("module.config.Config.get") as mock_get:
        config = MagicMock()
        mock_get.return_value = config
        yield config

@pytest.fixture
def sample_item():
    return {"id": 1, "name": "item", "value": 100}
```

## 文件系统与数据库夹具

```python
@pytest.fixture
def in_memory_db():
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE items (id INTEGER, name TEXT)")
    yield connection
    connection.close()
```

```python
def test_file_write(fs):
    path = Path("/workspace/output.txt")
    write_to_file(path, "content")
    assert path.read_text(encoding="utf-8") == "content"
```

| 场景 | 推荐做法 |
| --- | --- |
| 单测或集成测试需要文件隔离 | `fs` |
| 需要读取真实模板文件 | `fs.add_real_file()` |
| 需要真实 SQL 行为 | `:memory:` |

不要在文件测试里再引入 `tmp_path`、`tempfile`、`mock_open`。

## 夹具层级

```text
tests/
├── conftest.py
├── feature/
│   ├── conftest.py
│   ├── test_service.py
│   └── test_service_integration.py
└── workflow/
    ├── conftest.py
    └── test_handler.py
```

- 父目录 `conftest.py` 会自动向下生效
- 只在某个子目录使用的夹具，不要上提到全局
- 复用范围扩大了，再逐层上提
- 多数单元测试先收在主测试文件里，只有层次或场景明显不同再拆分

## 作用域

```python
@pytest.fixture
def item():
    return {"id": 1}

@pytest.fixture(scope="module")
def api_server():
    ...

@pytest.fixture(scope="session")
def test_settings():
    ...
```

默认用函数级作用域。只有当初始化真的昂贵而且共享不会污染测试时，才扩大作用域。

## 组合夹具

```python
@pytest.fixture
def user():
    return User(name="tester")

@pytest.fixture
def authenticated_user(user, mock_auth):
    mock_auth.login(user)
    return user

def test_can_access_dashboard(authenticated_user):
    result = access_dashboard(authenticated_user)
    assert result.status == "ok"
```

组合夹具要保持清楚：读测试时，能一眼看出依赖链。

## 参数化夹具

```python
@pytest.fixture(params=["sqlite", "postgres"])
def database(request):
    if request.param == "sqlite":
        return SQLiteDB(":memory:")
    return PostgresDB("test_db")

def test_query_works(database):
    result = database.query("SELECT 1")
    assert result is not None
```

只有当同一组行为确实要在多套环境下重复验证时，才用参数化夹具。

## 夹具反模式

```python
# ❌ 返回共享可变对象
@pytest.fixture
def items():
    return shared_list

# ✅ 返回新对象
@pytest.fixture
def items():
    return [1, 2, 3]
```

```python
# ❌ 依赖太多，看不出重点
@pytest.fixture
def huge_fixture(config, db, api, cache, processor):
    ...

# ✅ 每个夹具只解决一个准备问题
@pytest.fixture
def prepared_cache():
    ...
```
