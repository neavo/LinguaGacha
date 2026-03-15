---
name: pytest-ruler
description: 基于 pytest 的 TDD 测试工作流技能。用于编写、补充、重构和审查测试，尤其是在用户提到 `pytest`、`TDD`、`add tests`、`write tests`、`unit tests`、`test coverage`、`test-driven development`、测试覆盖率或测试重构时使用。
---

# Pytest Ruler

按这套规则写 pytest：先验证对外行为，再补实现细节。

## 核心目标

- 让测试回答“功能有没有按要求工作”，而不是“内部是不是刚好这样写”
- 让测试在重构后依然稳，只要行为没变就不该大面积失效
- 让测试一眼能看懂，最好就是 `Arrange -> Act -> Assert`
- 让边界可控，不碰真实网络，不依赖脏磁盘数据

## 核心规则

1. 先走 `Red -> Green -> Refactor`
2. 优先断言可观察行为，不把内部实现当主要断言对象
3. 文件系统统一优先用 `pyfakefs` 的 `fs`；数据库统一优先用 `:memory:`
4. 网络、外部 SDK、系统边界才用 `patch`，并且要 patch 在使用点
5. 集成测试和场景测试不要把同仓库内部模块全 mock 掉
6. 每个测试都要证明一条明确需求，并且失败时能说明问题
7. 可测试单元默认要求分支覆盖率 `> 90%`；达不到必须注明原因并显式确认

## 断言什么

优先断言这些公开结果：

| 优先对象 | 典型例子 |
| --- | --- |
| 输入输出 | 返回值、抛错、生成内容 |
| 最终状态 | 状态字段、对象快照、可读取配置 |
| 公开事件 | 事件类型、事件载荷、回调结果 |
| 持久化结果 | 数据库记录、写入文件、缓存对外视图 |

如果一个断言只能说明“内部刚好这么实现”，就先停下来改写测试。

## 白盒禁区

新增测试不要再走这些老路：

- 不要把私有属性、内部缓存、临时变量当主要断言
- 不要把 `call_args`、`call_args_list`、mock 调用细枝末节当主要断言
- 不要围着 `threading.Thread(...)` 的构造参数写断言，除非那本身就是需求
- 不要用 `Class.__new__(Class)` 或手工塞属性去拼“半成品对象”
- 不要新增 `tmp_path`、`tempfile`、`mock_open`
- 不要只断言 “mock 被这样调用了”，却不检查最终公开结果

推荐思路：

- 真实构造对象
- patch 副作用边界，不跳过构造本身
- 记录结果快照，再对结果做断言

## 边界隔离

| 边界 | 推荐做法 | 不推荐 |
| --- | --- | --- |
| 文件系统 | `fs` 夹具 | `tmp_path`、`tempfile`、`mock_open` |
| SQLite | `:memory:` 或等价内存数据库 | 完全 mock 掉数据库读写 |
| 网络 / 外部 SDK | `patch` 外部调用 | 连真实网络或伪造半套系统 |
| 日志 | 收集消息列表再断言 | 盯 `logger.call_args_list` |
| 事件 | 记录公开事件序列再断言 | 盯内部状态位变化 |
| 线程 | 替换成同步 worker 入口，或等明确完成信号 | 检查线程对象构造细节 |
| 同仓库内部模块 | 能跑真逻辑就跑真逻辑 | 全量 `MagicMock()` 套娃 |

## 测试写法约定

### AAA 结构

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

### 异常测试

```python
def test_rejects_negative_amount():
    with pytest.raises(ValueError, match="must be positive"):
        transfer(amount=-100)
```

### 参数化测试

只在“同一种行为，不同输入”时用 `@pytest.mark.parametrize`。

```python
@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, "zero"), (1, "positive"), (-1, "negative")],
)
def test_classify_number(value, expected):
    assert classify_number(value) == expected
```

如果其实是不同业务行为，就拆成多个测试。

## 测试文件组织

- 同一业务文件的单元测试默认集中在一个主测试文件中，避免无理由分散
- 不要把同一被测对象的测试随手散落到多个目录或多个名称含糊的测试文件里
- 只有当测试层次不同、场景边界明显不同，或单个测试文件已经明显影响可读性时，才拆分到多个测试文件
- 拆分后的文件名要直接说明测试目的，让人一眼知道该去哪里找

```text
推荐
tests/
└── feature/
    ├── test_service.py
    └── test_service_integration.py

不推荐
tests/a/test_service_logic.py
tests/b/test_service_errors.py
tests/c/test_service_misc.py
```

## 夹具放置

- 真正全局通用的夹具才放 `tests/conftest.py`
- 只服务某个领域的夹具，放对应目录下的 `conftest.py`
- 夹具离使用位置越近越好，避免把局部需求塞进全局
- 夹具保持聚焦，别造“什么都包进去”的魔法大夹具

## 旧测试整理流程

改旧白盒测试时，按这个顺序最省事：

1. 先扫反模式：`__new__`、`call_args`、`call_args_list`、`tmp_path`、`mock_open`
2. 先说清这个测试真正想证明什么业务行为
3. 把“内部调用断言”改成“结果快照断言”
4. 把重复准备逻辑收进最近的 `conftest.py`
5. 能用真实内存 DB / 虚拟文件系统，就不要手造假的系统壳
6. 跑格式化、静态检查和目标测试

## 白盒巡检命令

```powershell
rg -n "__new__|call_args|call_args_list|tmp_path|mock_open" tests
```

## 常用命令

```powershell
uv run pytest tests/ -v
uv run pytest tests/ --cov=<module> --cov-branch --cov-report=term-missing
uv run pytest tests/ --cov=<module> --cov-branch --cov-fail-under=90
```

## 提交前检查

- 测试名能直接说清业务意图
- 测试结构清楚，最好就是 `Arrange / Act / Assert`
- 没有新增白盒断言和旧反模式
- 夹具放在合适的 `conftest.py`
- 文件系统和数据库边界处理符合本规则
- 跑过相关 `pytest`

## 参考文档

| 场景 | 读取 |
| --- | --- |
| 避免白盒断言、整改旧测试 | [references/anti-patterns.md](references/anti-patterns.md) |
| 组织 `conftest.py` 和复用夹具 | [references/fixtures.md](references/fixtures.md) |
| 编写集成测试和场景测试 | [references/integration.md](references/integration.md) |
| patch 外部边界、单例、网络与文件 | [references/mocking.md](references/mocking.md) |
| 测线程入口、完成信号和公开结果 | [references/threading.md](references/threading.md) |
