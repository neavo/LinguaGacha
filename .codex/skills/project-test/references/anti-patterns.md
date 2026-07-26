# 测试反模式

只在需要定位测试坏味道或整改旧测试时读取本文件。下面的信号用于发现候选项，不是机械删除规则。

## 快速判断

| 信号 | 风险 | 优先改法 |
| --- | --- | --- |
| 测试名只有 `works`、`handles case` | 失败时看不出需求 | 写出输入条件和公开结果 |
| 只断言非空、长度或对象存在 | 没有证明业务语义 | 断言具体返回值、状态、事件或错误 |
| 只检查 mock 调用 | 测到协作剧本而非结果 | 先断言结果，再保留必要契约调用 |
| 读取私有字段或手拼半成品对象 | 与实现强耦合 | 走公开构造和公开观察面 |
| 深层 mock、连续 mock 多个领域模块 | 测试只验证自己搭出的系统 | 运行真实轻量逻辑，只替换干扰测试目的的边界 |
| 固定睡眠等待异步结果 | 慢且易抖动 | 等待事件、Promise、队列或状态条件 |
| 依赖测试顺序或共享可变状态 | 单独运行与并发运行不可靠 | 每个测试创建并清理自己的状态 |
| 操作真实用户目录或外部服务 | 污染环境且不可重复 | 使用临时目录、测试数据库、fake 服务或测试环境 |
| 多个用例只换无语义值 | 重复而不增加风险覆盖 | 参数化同一行为，或删除重复 |
| 为覆盖率制造不可达组合 | 维护成本高且无产品价值 | 回到公开入口、历史缺陷和风险模型 |

`tmp_path`、`call_args`、`vi.mock` 或参数化本身都不是反模式；只有它们让测试偏离目标行为时才需要调整。

## 白盒断言示例

```python
# 差：只证明内部方法被调用
service.save.assert_called_once_with(status="done")

# 好：证明调用方可观察到的结果
assert repository.read(job_id).status == "done"
```

```ts
// 差：只证明内部 setter 收到某个对象
expect(setState).toHaveBeenCalledWith({ open: true });

// 好：证明用户可见状态
expect(dialog).toHaveAttribute("aria-hidden", "false");
```

调用参数若属于外部协议、计费、安全或幂等契约，可以作为补充断言保留。

## 隔离失真

- `Class.__new__`、`as unknown as` 和手工塞字段常会绕过关键初始化；优先使用公开工厂或最小 builder。
- `mock_open` 适合极窄的 `open()` 协作测试，不适合证明路径、编码、遍历、移动或权限语义。
- 内存数据库适合仓储规则；涉及真实数据库方言、迁移或锁时，需要对应集成环境。
- fake timer 适合调度规则；涉及真实事件循环或进程边界时，需要更接近运行环境的测试。

半成品对象与公开工厂的区别：

```python
# 差：绕过初始化后手工补字段
service = Service.__new__(Service)
service.client = fake_client

# 好：通过公开构造边界替换副作用
service = create_service(client=fake_client)
assert service.run().status == "done"
```

## 组织失焦

下面情况值得整理：

- 同一行为在多个文件中重复断言；
- 一个测试同时证明多个独立失败原因；
- helper 隐藏关键输入、动作或断言；
- 单元、集成和端到端测试混在同一命令中且成本不可控；
- 文件命名与仓库约定不一致，无法从失败定位责任边界。

## 审查搜索

可搜索以下候选模式，再逐项阅读上下文：

```text
__new__
call_args / mock.calls / toHaveBeenCalled
mock_open / vi.mock
sleep / setTimeout
print / console.log
真实 URL、用户目录或固定数据库地址
```

搜索结果不是问题清单。交付时说明每项为何保留、修改、合并或删除。
