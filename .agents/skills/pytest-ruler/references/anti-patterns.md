# Anti-Patterns

## Bad Naming

```python
# ❌
def test_func1(): ...
def test_it_works(): ...

# ✅ Describe the expected behavior
def test_returns_empty_list_when_input_is_none(): ...
def test_raises_value_error_for_negative_amount(): ...
```

## Magic Test Data

```python
# ❌ Meaningless values
def test_user():
    user = create_user("aaa", "bbb", 123)
    assert user.is_valid()

# ✅ Data expresses intent
def test_user_with_valid_email():
    user = create_user(name="John Doe", email="john@example.com", age=25)
    assert user.is_valid()

def test_user_rejects_invalid_email():
    user = create_user(name="John Doe", email="not-an-email", age=25)
    assert not user.is_valid()
```

## Meaningless Tests

```python
# ❌ Proves nothing useful
assert obj is not None                              # Tests existence, not behavior
assert len([1, 2, 3]) == 3                          # Tests Python, not your code
assert calculate_total([1, 2, 3]) == sum([1, 2, 3]) # Duplicates implementation

# ✅ Tests actual behavior
def test_returns_zero_for_empty_list():
    assert calculate_total([]) == 0

def test_handles_negative_values():
    assert calculate_total([-5, 10]) == 5
```

## Testing Implementation Details

```python
# ❌ Testing internal state
def test_cache_internal():
    service = CacheService()
    service.get("key")
    assert "key" in service._cache_dict

# ❌ Patching internal method to verify short-circuit — still implementation-bound
def test_cached_via_internal_patch():
    service = CacheService()
    service.get("key")
    with patch.object(service, "fetch_from_source") as mock:
        service.get("key")
        mock.assert_not_called()

# ✅ Test through injected dependency (external boundary)
def test_cached_value_returned_without_extra_source_calls():
    source = MagicMock(return_value="value")
    service = CacheService(source=source)
    first = service.get("key")
    second = service.get("key")
    assert first == second == "value"
    source.assert_called_once()  # external source consulted only once
```

## Mock Mistakes

```python
# ❌ Wrong mock location (definition site)
@patch("module.utils.helper")

# ✅ Correct (usage site)
@patch("module.service.helper")
```

```python
# ❌ Mock without verification
@patch("module.api.send")
def test_sends_data(mock_send):
    process_and_send(data)
    # Forgot to verify!

# ✅ Verify mock was called
@patch("module.api.send")
def test_sends_data(mock_send):
    process_and_send(data)
    mock_send.assert_called_once_with(expected_payload)
```

```python
# ❌ Mock returns wrong structure
mock_api.return_value = {"data": "value"}
# But real API returns: {"data": {"items": [...]}}

# ✅ Match real response structure
mock_api.return_value = {"data": {"items": [{"id": 1}]}}
```

## File I/O Isolation Anti-Patterns

```python
# ❌ Disk-backed temporary files in unit tests
def test_write(tmp_path):
    path = tmp_path / "out.txt"
    save(path)

# ✅ Use pyfakefs fs fixture
def test_write(fs):
    path = Path("/workspace/out.txt")
    save(path)
```

```python
# ❌ Patching open only covers part of file APIs
with patch("builtins.open", mock_open(read_data="x")):
    load()

# ✅ fs fixture covers Path/open/os/shutil/glob together
def test_load(fs):
    Path("/workspace/data.txt").write_text("x", encoding="utf-8")
    assert load() == "x"
```

## Test Isolation

```python
# ❌ Tests depend on execution order
class TestOrdered:
    shared_state = []
    def test_first(self):
        self.shared_state.append(1)
    def test_second(self):
        assert self.shared_state == [1]  # Fails if run alone

# ✅ Each test is independent
def test_first():
    state = [1]
    assert state == [1]
```

```python
# ❌ Fixture returns mutable shared object
@pytest.fixture
def shared_list():
    return global_list  # Mutations affect other tests

# ✅ Return fresh copy
@pytest.fixture
def items():
    return [1, 2, 3]
```

## Time-Dependent Tests

```python
# ❌ Flaky - fails at certain times
def test_expiry():
    token = create_token()
    assert not token.is_expired()

# ✅ Control time explicitly
@patch("module.auth.datetime")
def test_expiry(mock_dt):
    mock_dt.now.return_value = datetime(2024, 1, 1, 12, 0)
    token = create_token()
    assert not token.is_expired()
```

## Coverage Traps

```python
# ❌ Only happy path
def test_process():
    assert process(valid_data) == expected

# ✅ Cover edge cases and errors
def test_process_valid():
    assert process(valid_data) == expected

def test_process_empty():
    assert process([]) == []

def test_process_invalid_raises():
    with pytest.raises(ValueError):
        process(None)
```

## Over-Abstraction

```python
# ❌ Too DRY - hard to understand each test
def assert_valid(resp, code, body):
    assert resp.status == code
    assert resp.body == body

def test_create(): assert_valid(create(), 201, {...})

# ✅ Readable, some repetition is OK
def test_create_returns_201():
    response = create()
    assert response.status == 201
    assert response.body["id"] is not None
```
