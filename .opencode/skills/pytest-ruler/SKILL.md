---
name: pytest-ruler
description: 基于 pytest 的 TDD 测试工作流，触发词：TDD、补测试、写测试、测试脚本、单元测试、测试覆盖率、测试驱动开发
---

# Pytest Ruler

## Core Principles

1. **TDD Cycle**: Red -> Green -> Refactor
2. **Test Behavior**: Verify observable outcomes, not internal implementation
3. **Isolation**: File system always uses `pyfakefs` `fs` fixture; database prefers `:memory:`; network and external SDKs use `unittest.mock.patch`
4. **Meaningful Tests**: Each test validates a requirement and can fail

## Mock Strategy

| Boundary | Recommended | Rationale |
| --- | --- | --- |
| File system | `fs` fixture (`pyfakefs`) | Intercepts all `Path`/`open`/`os`/`shutil`/`glob` calls in-process |
| SQLite | `:memory:` | Real engine, zero disk I/O, auto-cleanup on `conn.close()` |
| HTTP / external SDK | `unittest.mock.patch` | Eliminates network; patch at **usage site** |
| Same-repo internal modules | **Do NOT mock** in integration/scenario | Let real code run to catch interaction bugs |

`tmp_path`, `tempfile`, and `mock_open` are anti-patterns and must not be used in new tests.

## CLI

```bash
uv run pytest tests/ -v
uv run pytest tests/ --cov=<module> --cov-branch --cov-report=term-missing
uv run pytest tests/ --cov=<module> --cov-branch --cov-fail-under=80
```

## File Naming

| Source                 | Test                               |
| ---------------------- | ---------------------------------- |
| `module/Foo.py`        | `tests/module/test_foo.py`         |
| `module/sub/BarBaz.py` | `tests/module/sub/test_bar_baz.py` |

Keep path structure, PascalCase → snake_case, add `test_` prefix. Defer to actual project conventions when they differ.

## TDD Cycle

**Red** → Write failing test:

```python
def test_returns_sum_of_items():
    assert calculate_total([10, 20, 30]) == 60
```

**Green** → Minimal implementation:

```python
def calculate_total(items: list[int]) -> int:
    return sum(items)
```

**Refactor** → Improve while tests stay green.

## Test Structure (AAA)

```python
def test_user_can_checkout_with_valid_cart():
    # Arrange
    cart = Cart(items=[Item("book", 25)])
    payment = FakePaymentGateway(success=True)
    # Act
    result = checkout(cart, payment)
    # Assert
    assert result.status == "completed"
    assert result.total == 25
```

## Exception Testing

```python
def test_rejects_negative_amount():
    with pytest.raises(ValueError, match="must be positive"):
        transfer(amount=-100)
```

## Test Types

| Type | Purpose | What to mock | What stays real |
| --- | --- | --- | --- |
| **Unit** | Single function/class | FS (`fs`), DB (`:memory:`), HTTP/SDK (`patch`) | The unit under test |
| **Integration** | Component collaboration | HTTP/SDK (`patch`), FS (`fs`) | All internal modules |
| **Scenario** | End-to-end user workflow | HTTP/SDK (`patch`) | Internal modules + `:memory:` DB |

## Parametrized Tests

Use `@pytest.mark.parametrize` for **same behavior, varying inputs**:

```python
@pytest.mark.parametrize("value,expected", [
    (0, "zero"), (1, "positive"), (-1, "negative"),
])
def test_classify_number(value, expected):
    assert classify(value) == expected
```

**Do NOT parametrize** different behaviors — write separate tests:

```python
# ❌ Different behaviors forced into one test
@pytest.mark.parametrize("user,action,expected", [
    (admin, "delete", True),   # Permission check
    (None, "delete", Error),   # Auth check ← different behavior!
])

# ✅ Separate tests
def test_admin_can_delete(): ...
def test_unauthenticated_raises(): ...
```

## Anti-Patterns

```python
assert "key" in service._cache          # ❌ Testing implementation
assert config is not None               # ❌ Meaningless assertion
with patch("a"), patch("b"), patch("c"): ...  # ❌ Over-mocking
assert calculate_total(items) == sum(items)   # ❌ Duplicating impl
```

## References

| When you need to...              | Load                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| Mock HTTP, DB, files, singletons | [references/mocking.md](references/mocking.md)             |
| Write integration/scenario tests | [references/integration.md](references/integration.md)     |
| Organize fixtures in conftest.py | [references/fixtures.md](references/fixtures.md)           |
| Avoid common testing mistakes    | [references/anti-patterns.md](references/anti-patterns.md) |
| Test threaded code               | [references/threading.md](references/threading.md)         |
