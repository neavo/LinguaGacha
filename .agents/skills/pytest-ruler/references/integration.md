# Integration and Scenario Tests

## When to Write Integration Tests

- Multiple functions must cooperate to complete a workflow
- Data flows through several layers (API → Service → Repository)
- State changes span multiple components

## Integration Test: Data Pipeline

```python
def test_file_processing_pipeline(fs):
    """Test: read → parse → transform → write"""
    input_path = Path("/workspace/input.txt")
    output_path = Path("/workspace/output.json")
    input_path.write_text("line1\nline2\nline3", encoding="utf-8")

    pipeline = DataPipeline(input_path, output_path)
    pipeline.run()

    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result["line_count"] == 3
```

## Integration Test: Event-Driven

```python
def test_event_triggers_downstream_actions():
    results = []
    event_bus = EventBus()
    processor = DataProcessor(event_bus)
    notifier = Notifier(event_bus)
    notifier.on_notify = lambda msg: results.append(msg)

    processor.process({"id": 1, "value": 100})

    assert len(results) == 1
    assert "processed" in results[0]
```

## Scenario Test: User Workflow

```python
def test_translation_workflow():
    source_text = "Hello, world"
    # Mock only external boundary (API)
    with patch("module.api.TranslationAPI.translate") as mock_api:
        mock_api.return_value = "你好，世界"
        project = Project.create(source_text)
        translator = TranslationService(project)
        translator.run()
        result = project.get_result()

        assert result.translated_text == "你好，世界"
        assert result.status == "completed"
```

## Unit vs Integration Decision

| Scenario                       | Test Type   |
| ------------------------------ | ----------- |
| Pure function with clear I/O   | Unit        |
| Complex branching logic        | Unit        |
| Workflow spanning functions    | Integration |
| Error handling across layers   | Integration |
| External API interaction       | Unit + mock |
| Database transaction integrity | Integration |

## Common Mistakes

```python
# ❌ Over-mocking internal functions
with patch("step1"), patch("step2"), patch("step3"):
    run_workflow(input)  # Nothing real tested

# ✅ Mock only external boundaries
with patch("external_api.call") as mock:
    result = run_workflow(input)  # Internal logic runs
```
