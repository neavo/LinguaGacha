# Fixture Organization

## Basic Fixtures

```python
# conftest.py
@pytest.fixture
def mock_config():
    with patch("module.config.Config.get") as mock:
        config = MagicMock()
        mock.return_value = config
        yield config

@pytest.fixture
def mock_logger():
    with patch("module.logger.Logger.get") as mock:
        logger = MagicMock()
        mock.return_value = logger
        yield logger

@pytest.fixture
def sample_data():
    return {"id": 1, "name": "test_item", "value": 100}
```

## Fixture with Cleanup

```python
@pytest.fixture
def temp_database():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE items (id INTEGER, name TEXT)")
    yield conn
    conn.close()
```

## Temporary Files

Use `pyfakefs` `fs` fixture as the only file-system isolation strategy.

```python
def test_file_write(fs):
    file_path = Path("/workspace/output.txt")
    write_to_file(str(file_path), "content")
    assert file_path.read_text(encoding="utf-8") == "content"
```

| Scenario | Use |
| --- | --- |
| Unit/integration test with file operations | `fs` fixture |
| Need to read a real project file | `fs.add_real_file()` |
| SQLite persistence behavior | `:memory:` |

Do not use `tmp_path` / `tempfile` / `mock_open` for file tests.

## Fixture Scope

```python
@pytest.fixture                  # Per-test (default)
@pytest.fixture(scope="module")  # Per-module
@pytest.fixture(scope="session") # Per-session
```

## Composing Fixtures

```python
@pytest.fixture
def user():
    return User(name="test_user")

@pytest.fixture
def authenticated_user(user, mock_auth):
    mock_auth.login(user)
    return user

def test_can_access_dashboard(authenticated_user):
    result = access_dashboard(authenticated_user)
    assert result.status == "ok"
```

## Parameterized Fixtures

```python
@pytest.fixture(params=["sqlite", "postgres"])
def database(request):
    if request.param == "sqlite":
        return SQLiteDB(":memory:")
    return PostgresDB("test_db")

def test_query_works(database):
    # Runs twice: once with SQLite, once with Postgres
    result = database.query("SELECT 1")
    assert result is not None
```

## conftest.py Hierarchy

```
tests/
├── conftest.py              # Global fixtures (shared across all tests)
├── module/
│   ├── conftest.py          # Fixtures for module/ tests
│   ├── test_foo.py
│   └── sub/
│       ├── conftest.py      # Fixtures for module/sub/ tests
│       └── test_bar_baz.py
```

Mirror the source tree. Fixtures in parent `conftest.py` are available to all subdirectories.

## Fixture Anti-Patterns

```python
# ❌ Returns mutable shared state
@pytest.fixture
def items(): return shared_list       # ✅ return shared_list.copy()

# ❌ Magic fixture — too many dependencies
@pytest.fixture
def data(config, db, api, cache, processor): ...
# ✅ Keep fixtures focused and explicit
```
