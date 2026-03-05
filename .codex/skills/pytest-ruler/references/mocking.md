# Mocking Patterns

## Mock HTTP Requests

```python
@patch("module.api.httpx.Client.post")
def test_api_call(mock_post):
    mock_post.return_value = MagicMock(
        status_code=200,
        json=lambda: {"result": "success"}
    )
    result = call_api()
    assert result == {"result": "success"}
    mock_post.assert_called_once_with("https://api.example.com/data", json={"key": "value"})
```

## Mock File System

```python
def test_read_file(fs):
    path = Path("/workspace/config.json")
    path.write_text('{"k":"v"}', encoding="utf-8")
    result = read_config(str(path))
    assert result["k"] == "v"
```

```python
def test_reads_real_template_file(fs):
    fs.add_real_file("resource/preset/template.txt", read_only=True)
    assert load_template("resource/preset/template.txt")
```

## Mock Database

```python
def test_with_in_memory_db():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE items (id INTEGER, name TEXT)")
    conn.execute("INSERT INTO items VALUES (1, 'test')")
    with patch("module.db.get_connection", return_value=conn):
        result = query_items()
        assert len(result) == 1
```

## Mock Singleton

```python
@patch("module.config.Config.get")
def test_with_config(mock_get):
    mock_config = MagicMock()
    mock_config.api_key = "test-key"
    mock_get.return_value = mock_config
    result = function_using_config()
    assert result == "expected"
```

## Mock External SDK

```python
@patch("openai.OpenAI")
def test_llm_call(mock_llm_class):
    mock_client = MagicMock()
    mock_llm_class.return_value = mock_client
    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content="response"))]
    mock_client.chat.completions.create.return_value = mock_completion
    result = call_llm("prompt")
    assert result == "response"
```

## Mock Location Rule

Mock at the **usage site**, not the definition site:

```python
# module/service.py imports: from module.utils import helper

# ✅ @patch("module.service.helper")   — where it's used
# ❌ @patch("module.utils.helper")     — where it's defined
```

## Verify Mock Calls

```python
@patch("module.api.post")
def test_api_called_correctly(mock_post):
    call_api({"data": "value"})
    mock_post.assert_called_once_with("https://api.example.com", json={"data": "value"})
```

## Mock Exceptions

```python
@patch("module.api.fetch")
def test_handles_timeout(mock_fetch):
    mock_fetch.side_effect = TimeoutError("connection timeout")
    with pytest.raises(ServiceError, match="timeout"):
        call_api()
```
