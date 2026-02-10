# pytest-ruler 改进计划（强约束版）

目标：让 pytest-ruler 成为“准则”而不是“指南”。文档必须简洁、无歧义、强约束，且示例代码可直接复制执行。

## 必须修复（按优先级）

### 1. 触发词格式错误

- **文件**: `SKILL.md`
- **问题**: `TDD | |补测试` 存在多余的空管道符。
- **操作**: 删除空管道符，保持触发词列表为单一、可读、可匹配的格式。

### 2. 统一测试目录结构（唯一方案）

- **文件**: `SKILL.md`、`references/fixtures.md`
- **问题**: `SKILL.md` 规定测试路径镜像源码（如 `module/Foo.py` -> `tests/module/test_foo.py`），但 `references/fixtures.md` 的 conftest 层级示例按 `tests/unit/`、`tests/integration/` 分目录，口径冲突。
- **操作**:
  - 明确唯一目录方案：`tests/` 必须镜像源码路径；禁止在文档中展示 `tests/unit/`、`tests/integration/` 这类分层结构。
  - 将 `references/fixtures.md` 的 conftest 层级示例改为镜像结构（示例包含 `tests/conftest.py` 与 `tests/<pkg>/conftest.py` 的层级即可）。

### 3. 统一 Mock 工具（唯一方案）

- **文件**: `references/mocking.md`
- **问题**: 文档出现 `pytest-mock` 的推荐语，与 `SKILL.md` 的 Mock Strategy 不一致，且引入多方案选择。
- **操作**: 删除所有 `pytest-mock` / `mocker` 相关内容，仅保留 `unittest.mock.patch` 作为 Mock 的唯一方案。

### 4. 纠正“测试可观察行为”正例

- **文件**: `references/anti-patterns.md`
- **问题**: “正确示例”通过 `patch.object(service, "fetch_from_source")` 断言内部方法未调用，属于实现细节绑定，违反“只测可观察行为”的核心原则。
- **操作**: 用“外部边界可观察结果”重写示例，禁止通过 patch 内部方法名来证明缓存/短路等行为。

### 5. threading 文档禁止使用 async 命名

- **文件**: `references/threading.md`
- **问题**: 文档明确区分线程与 asyncio，但示例函数名出现 `test_async_*`、`start_async`，语义混淆。
- **操作**: 将示例命名统一为 `threaded/background` 语义（如 `test_threaded_callback`、`start_background`）。

### 6. 明确 Unit / Integration / Scenario 的 Mock 边界（可执行定义）

- **文件**: `SKILL.md`
- **问题**: “external deps / external boundaries” 定义模糊，无法指导“该 mock 什么”。
- **操作**: 用可执行定义重写表格描述，并补充本项目语境例子（至少覆盖：文件系统（强制 `fs`）、SQLite（优先 `:memory:`）、网络/外部 SDK（强制 `patch`）、同仓库内部模块协作（Integration 不 mock 内部组件））。

### 7. 示例 I/O 编码必须显式一致

- **文件**: `references/fixtures.md`、`references/anti-patterns.md`、`references/mocking.md`、`references/integration.md`
- **问题**: `Path.write_text(..., encoding="utf-8")` 与 `Path.read_text()` 混用默认编码；Windows 下会导致行为不一致。
- **操作**: 所有示例中的 `Path.read_text()` / `Path.write_text()` 必须显式带 `encoding="utf-8"`。

### 8. 线程同步必须断言 wait 返回值

- **文件**: `references/threading.md`
- **问题**: `Event.wait(timeout=...)` 未断言返回值会导致超时静默通过，制造 flaky。
- **操作**: 所有 `wait(timeout=...)` 必须写成 `assert ... , "Timed out"`。

### 9. Mock 调用断言必须使用 assert_called_once_with

- **文件**: `references/mocking.md`
- **问题**: `assert_called_once()` + `assert_called_with()` 连用冗余且语义不严谨。
- **操作**: 统一替换为 `assert_called_once_with(...)`。

### 10. CLI 命令必须遵循本仓库 uv 规范

- **文件**: `SKILL.md`
- **问题**: 当前示例使用裸 `pytest ...`，与仓库“所有指令通过 uv 执行”的强约束不一致。
- **操作**: 将 CLI 示例改为 `uv run pytest ...`（覆盖 verbose 与 coverage 两类用法）。

## 验收标准

- 文档内部无自相矛盾（目录结构、mock 工具、原则与示例）。
- 示例代码无平台相关隐患（显式编码、wait 断言），不引入可预见的 flaky。
- `SKILL.md` 单独阅读即可得出“必须怎么做”，不需要在多个 references 里拼规则。
