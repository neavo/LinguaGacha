# 跨栈边界测试示例

只在任务涉及后端与前端、宿主与 UI、协议、事件流、初始化数据或同步 mutation 契约时读取本文件。

## 判断权威来源

写测试前先确认：
- 协议字段、错误码和事件 topic 属于协议边界。
- 领域事实属于后端或核心领域层。
- UI 运行态事实属于前端状态容器和 selector。
- 页面局部筛选、弹窗、排序不应被写回协议或全局状态。
- 单个业务文件的具体断言仍然回到它的唯一对应测试文件；本文件只指导真实跨边界场景。

## 后端侧：发布标准事件

```python
def test_publish_event_creates_standardized_envelope() -> None:
    service = EventStreamService()
    subscriber = service.add_subscriber()

    service.publish_domain_event(
        "job.progress",
        {"processed": 2, "total": 5},
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "job.progress_changed"
    assert envelope.data == {
        "processed": 2,
        "total": 5,
    }
```

## 后端侧：领域事件转协议更新

```python
def test_domain_event_is_translated_to_public_update() -> None:
    service = EventStreamService(
        event_bridge=PublicUpdateBridge(
            snapshot_builder=build_snapshot,
        )
    )
    subscriber = service.add_subscriber()

    service.publish_domain_event(
        "record.saved",
        {"ids": [1, 2], "revision": 5},
    )

    envelope = subscriber.get_nowait()
    assert envelope.topic == "state.updated"
    assert envelope.data["source"] == "record.saved"
    assert envelope.data["updatedSections"] == ["records"]
    assert envelope.data["operations"][0]["records"][0]["id"] == 1
```

## 前端侧：消费初始化分片

```ts
it("按 section 独立写入初始化数据", () => {
  const store = createSessionStore();

  store.applyInitialSection("session", {
    session: { id: "demo", loaded: true },
    revisions: { global: 1, sections: { session: 1 } },
  });
  store.applyInitialSection("records", {
    records: { total: 2 },
    revisions: { sections: { records: 3 } },
  });

  expect(store.getState().session.id).toBe("demo");
  expect(store.getState().records.total).toBe(2);
  expect(store.getState().revisions.sections.records).toBe(3);
});
```

## 前端侧：消费事件流

```ts
await act(async () => {
  eventStream.emit("state.updated", {
    source: "record.saved",
    revision: 2,
    updatedSections: ["records"],
    operations: [
      {
        op: "merge_records",
        records: [{ id: 1, label: "updated", status: "DONE" }],
      },
    ],
  });
  await Promise.resolve();
});

await waitForCondition(() => snapshots.at(-1)?.version === 2);

expect(snapshots.at(-1)).toMatchObject({
  reason: "record.saved",
  updatedSections: ["records"],
  recordIds: [1],
});
```

## 契约变更测试矩阵

| 改动 | 后端侧测试 | 前端侧测试 |
| --- | --- | --- |
| 新增事件 topic | 事件发布 / bridge topic 测试 | 事件流消费与忽略未知 topic 测试 |
| 修改初始化分片 | 初始化 service 或 serializer 测试 | 状态容器初始化消费测试 |
| 修改公开 update 操作 | bridge payload 测试 | store merge 与 signal 测试 |
| 修改同步 mutation 返回 | route / service 测试 | API client 或页面状态 hook 测试 |
| 修改错误码 | 错误映射测试 | UI 错误状态或展示测试 |

## 验证建议

跨栈契约改动至少执行：

```powershell
# 后端目标测试
uv run pytest tests/path/to/contract_test.py -v

# 前端目标测试
cd frontend
npm run test -- src/path/to/consumer.test.ts
npx tsc -p tsconfig.json --noEmit
```

如果项目不使用这些命令，换成仓库现有的等价测试、lint 和类型检查命令。
