# 集成测试与场景测试

## 什么时候写

这些情况优先写集成测试或场景测试：

- 多个函数或模块要一起完成一个流程
- 数据会跨层流动，比如 `API -> Service -> Repository`
- 一个操作会触发状态变化、事件广播和持久化写入
- 错误处理要跨多个组件验证

## 断言重点

集成测试最重要的是看公开结果，不要只看内部调用。

- 断言最终返回值
- 断言数据库记录或文件内容
- 断言公开事件序列和载荷
- 断言最终状态，而不是中间拼装细节

## 文件处理流程示例

```python
def test_file_processing_pipeline(fs):
    input_path = Path("/workspace/input.txt")
    output_path = Path("/workspace/output.json")
    input_path.write_text("line1\nline2\nline3", encoding="utf-8")

    pipeline = DataPipeline(input_path, output_path)
    pipeline.run()

    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result["line_count"] == 3
```

## 事件驱动流程示例

```python
def test_event_triggers_downstream_actions():
    received_events: list[tuple[str, dict[str, str]]] = []

    event_bus = EventBus()
    processor = DataProcessor(event_bus)
    notifier = Notifier(event_bus)
    notifier.on_notify = lambda payload: received_events.append(("notify", payload))

    processor.process({"id": 1, "value": 100})

    assert received_events == [("notify", {"status": "processed"})]
```

## 用户流程示例

```python
def test_user_workflow():
    payload = {"id": 1, "content": "submit"}

    with patch("module.external_api.send_job") as mock_api:
        mock_api.return_value = {"status": "ok", "job_id": "job-1"}

        session = WorkflowSession.create(payload)
        handler = WorkflowHandler(session)
        handler.execute()

        result = session.get_result()

        assert result == {"status": "ok", "job_id": "job-1"}
        assert session.state == "completed"
        assert session.events[-1]["name"] == "workflow.completed"
```

这里只 mock 外部接口；内部模块和数据流保持真实。

## 单测还是集成测试

| 场景 | 更适合的测试 |
| --- | --- |
| 纯函数、输入输出清楚 | 单测 |
| 分支很多的业务函数 | 单测 |
| 跨模块工作流 | 集成测试 |
| 跨层错误处理 | 集成测试 |
| 外部 API 交互 | 单测 + mock 外部边界 |
| 数据库事务与持久化一致性 | 集成测试 |

## 常见错误

```python
# ❌ 把内部步骤全 mock 掉，结果什么真逻辑都没跑
with patch("module.workflow.step1"), patch("module.workflow.step2"):
    run_workflow(input_data)

# ✅ 只 mock 外部边界，内部逻辑照常跑
with patch("module.external_api.call") as mock_call:
    mock_call.return_value = {"status": "ok"}
    result = run_workflow(input_data)
    assert result["status"] == "ok"
```

## 一条简单判断

如果你把同仓库内部模块都替换成 `MagicMock()` 之后，测试还几乎不变，那这个测试多半已经偏成白盒壳子了。
