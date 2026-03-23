# Frontend Core Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `api/` 下建立 UI 与 Core 的本地 HTTP/SSE 边界，先打通工程生命周期、全局事件流、翻译/分析主链路与工作台主链路，并约束 `frontend/` 只能通过 `api.client` 访问 Core。

**Architecture:** 先在 `api/application` 建立稳定用例层，再由 `api/server` 暴露本地 `POST + JSON` 与 `GET /api/events/stream`。现有 `module/` 与 `base/` 暂时继续承载核心实现，但 UI 逐步改造为 `api.client` 消费者，并通过 `api/bridge/EventBridge.py` 统一消费标准化的 SSE topic。

**Tech Stack:** Python 3.14、PySide6、httpx、pytest、现有 `DataManager` / `Engine` / `EventManager`

---

## 0. 文件结构映射

### 新建目录与文件

- Create: `api/__init__.py`
- Create: `api/contract/__init__.py`
- Create: `api/contract/ApiError.py`
- Create: `api/contract/ApiResponse.py`
- Create: `api/contract/EventEnvelope.py`
- Create: `api/contract/ProjectDtos.py`
- Create: `api/contract/TaskDtos.py`
- Create: `api/contract/WorkbenchDtos.py`
- Create: `api/application/__init__.py`
- Create: `api/application/AppContext.py`
- Create: `api/application/ProjectAppService.py`
- Create: `api/application/TaskAppService.py`
- Create: `api/application/WorkbenchAppService.py`
- Create: `api/application/SettingsAppService.py`
- Create: `api/application/EventStreamService.py`
- Create: `api/bridge/__init__.py`
- Create: `api/bridge/EventTopic.py`
- Create: `api/bridge/EventBridge.py`
- Create: `api/server/__init__.py`
- Create: `api/server/CoreApiServer.py`
- Create: `api/server/ServerBootstrap.py`
- Create: `api/server/routes/__init__.py`
- Create: `api/server/routes/EventRoutes.py`
- Create: `api/server/routes/ProjectRoutes.py`
- Create: `api/server/routes/TaskRoutes.py`
- Create: `api/server/routes/WorkbenchRoutes.py`
- Create: `api/server/routes/SettingsRoutes.py`
- Create: `api/client/__init__.py`
- Create: `api/client/ApiClient.py`
- Create: `api/client/ProjectApiClient.py`
- Create: `api/client/TaskApiClient.py`
- Create: `api/client/WorkbenchApiClient.py`
- Create: `api/client/SettingsApiClient.py`
- Create: `api/client/SseClient.py`
- Create: `api/client/ApiStateStore.py`
- Create: `tests/api/__init__.py`
- Create: `tests/api/conftest.py`
- Create: `tests/api/test_event_bridge.py`
- Create: `tests/api/test_event_stream_service.py`
- Create: `tests/api/test_project_app_service.py`
- Create: `tests/api/test_task_app_service.py`
- Create: `tests/api/test_workbench_app_service.py`
- Create: `tests/api/test_settings_app_service.py`
- Create: `tests/api/test_core_api_server.py`
- Create: `tests/api/test_api_client.py`
- Create: `api/SPEC.md`

### 重点修改文件

- Modify: `app.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/ProjectPage.py`
- Modify: `frontend/Translation/TranslationPage.py`
- Modify: `frontend/Analysis/AnalysisPage.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `base/CLIManager.py`
- Modify: `pyproject.toml`

### 现有参考文件

- Check: `base/Base.py`
- Check: `base/EventManager.py`
- Check: `module/Data/DataManager.py`
- Check: `module/Engine/Engine.py`
- Check: `tests/module/data/test_data_manager.py`
- Check: `tests/module/engine/test_engine.py`
- Check: `tests/base/test_cli_manager.py`

### 计划约束

- 不在单个 patch 中一次性写入超大文件，按任务分批落地。
- 先为 `api/application` 和 `api/bridge` 建测试，再写最小实现。
- 每个任务完成后都要运行该任务对应的最小测试集合。
- 每个任务完成后都要单独提交，避免超大 diff。

## 1. 里程碑拆分

| 里程碑 | 闭环结果 |
| --- | --- |
| `M1` | 本地 Core 服务可启动，`/api/health` 与 `/api/events/stream` 可用 |
| `M2` | 工程创建、预览、加载、卸载全部改走 `api.client` |
| `M3` | 翻译与分析任务主链路改走 API，并能通过 SSE 更新状态 |
| `M4` | 工作台文件操作与快照改走 API |
| `M5` | 设置/规则主页面逐步迁移，`frontend/` 基本不再直连 Core |
| `M6` | `api/SPEC.md` 完成，CLI 策略收口，残留直连依赖被清理 |

## 2. 任务清单

### Task 1: 搭建 `api` 骨架与最小协议测试

**Files:**
- Create: `api/__init__.py`
- Create: `api/contract/ApiError.py`
- Create: `api/contract/ApiResponse.py`
- Create: `api/contract/EventEnvelope.py`
- Create: `api/server/CoreApiServer.py`
- Create: `api/server/ServerBootstrap.py`
- Create: `tests/api/test_core_api_server.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: 写失败测试，固定最小服务协议**

```python
import httpx

from api.server.ServerBootstrap import ServerBootstrap


def test_health_endpoint_returns_ok():
    base_url, shutdown = ServerBootstrap.start_for_test()
    response = httpx.get(f"{base_url}/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    shutdown()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_core_api_server.py::test_health_endpoint_returns_ok -v`
Expected: FAIL，提示 `ServerBootstrap` 不存在或本地测试服务无法启动

- [ ] **Step 3: 写最小实现**

```python
class CoreApiServer:
    HEALTH_PATH: str = "/api/health"

    def register_routes(self) -> None:
        ...
```

要求：

- 优先使用标准库 HTTP 服务器与现有 `httpx`，不要为第一步引入额外 Web 框架
- 只实现 `health` 与最小路由注册
- `ApiResponse` 统一输出 `{"ok": True, "data": ...}` 风格
- 不提前实现业务接口

- [ ] **Step 4: 运行最小测试确认通过**

Run: `uv run pytest tests/api/test_core_api_server.py -v`
Expected: PASS，`health` 接口返回 200

- [ ] **Step 5: 提交**

```bash
git add api pyproject.toml tests/api/test_core_api_server.py
git commit -m "feat: add api server skeleton"
```

### Task 2: 建立 `EventBridge` 与 `EventStreamService`

**Files:**
- Create: `api/bridge/EventTopic.py`
- Create: `api/bridge/EventBridge.py`
- Create: `api/application/EventStreamService.py`
- Create: `api/server/routes/EventRoutes.py`
- Create: `tests/api/test_event_bridge.py`
- Create: `tests/api/test_event_stream_service.py`
- Modify: `base/Base.py`

- [ ] **Step 1: 写失败测试，固定内部事件到外部 topic 的映射**

```python
from base.Base import Base
from api.bridge.EventBridge import EventBridge


def test_translation_progress_is_mapped_to_task_progress():
    topic, payload = EventBridge().map_event(
        Base.Event.TRANSLATION_PROGRESS,
        {"processed_line": 3, "total_line": 10},
    )
    assert topic == "task.progress_changed"
    assert payload["task_type"] == "translation"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_event_bridge.py::test_translation_progress_is_mapped_to_task_progress -v`
Expected: FAIL，提示 `EventBridge` 不存在或返回值不符合预期

- [ ] **Step 3: 写最小实现**

```python
class EventBridge:
    def map_event(self, event: Base.Event, data: dict) -> tuple[str | None, dict]:
        ...
```

要求：

- 只暴露文档里定义的 SSE topic
- 明确忽略不该对外暴露的内部事件
- `EventStreamService` 维护订阅者与标准化事件包，不透传内部 payload 原样

- [ ] **Step 4: 增加 SSE 流测试并验证**

Run: `uv run pytest tests/api/test_event_bridge.py tests/api/test_event_stream_service.py -v`
Expected: PASS，确认 topic 映射与事件包格式稳定

- [ ] **Step 5: 提交**

```bash
git add api/bridge api/application/EventStreamService.py api/server/routes/EventRoutes.py tests/api/test_event_bridge.py tests/api/test_event_stream_service.py
git commit -m "feat: add api event bridge and stream service"
```

### Task 3: 建立 `ProjectAppService` 并打通工程生命周期接口

**Files:**
- Create: `api/contract/ProjectDtos.py`
- Create: `api/application/ProjectAppService.py`
- Create: `api/server/routes/ProjectRoutes.py`
- Create: `api/client/ApiClient.py`
- Create: `api/client/ProjectApiClient.py`
- Create: `tests/api/test_project_app_service.py`
- Create: `tests/api/test_api_client.py`
- Modify: `module/Data/DataManager.py`
- Modify: `app.py`

- [ ] **Step 1: 写失败测试，固定工程用例层返回 DTO**

```python
def test_load_project_returns_loaded_snapshot(project_app_service, lg_path):
    result = project_app_service.load_project({"path": lg_path})
    assert result["project"]["path"] == lg_path
    assert result["project"]["loaded"] is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_project_app_service.py::test_load_project_returns_loaded_snapshot -v`
Expected: FAIL，提示 `ProjectAppService` 不存在或返回格式不匹配

- [ ] **Step 3: 写最小实现**

```python
class ProjectAppService:
    def load_project(self, request: dict[str, str]) -> dict[str, object]:
        ...

    def create_project(self, request: dict[str, str]) -> dict[str, object]:
        ...
```

要求：

- 用例层负责把 `DataManager` 调用整理成稳定 DTO
- 不把 `DataManager` 原始返回值直接抛给客户端
- `app.py` 中为 UI 模式补充 Core 服务启动逻辑，但 CLI 暂时保持旧行为

- [ ] **Step 4: 补上客户端测试**

Run: `uv run pytest tests/api/test_project_app_service.py tests/api/test_api_client.py -v`
Expected: PASS，确认客户端可以用 JSON body 调用工程接口

- [ ] **Step 5: 提交**

```bash
git add app.py api/client api/contract/ProjectDtos.py api/application/ProjectAppService.py api/server/routes/ProjectRoutes.py tests/api/test_project_app_service.py tests/api/test_api_client.py
git commit -m "feat: add project application service and client"
```

### Task 4: 改造 `ProjectPage` 与 `AppFluentWindow` 走工程 API

**Files:**
- Modify: `frontend/ProjectPage.py`
- Modify: `frontend/AppFluentWindow.py`
- Create: `api/client/ApiStateStore.py`
- Modify: `tests/api/test_api_client.py`
- Modify: `tests/base/test_cli_manager.py`

- [ ] **Step 1: 写失败测试，固定 UI 不再直接依赖 `DataManager.load_project`**

```python
def test_project_page_uses_project_api_client(mocker):
    client = mocker.Mock()
    page = build_project_page(project_client=client)
    page.on_open_project()
    assert client.load_project.called
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_client.py -k project_page -v`
Expected: FAIL，提示页面仍依赖旧入口或构造方式不支持注入客户端

- [ ] **Step 3: 实现最小改造**

要求：

- `ProjectPage` 的创建/预览/打开流程统一经 `ProjectApiClient`
- `AppFluentWindow` 的工程关闭与全局加载态由 `ApiStateStore` + SSE 事件驱动
- 保留现有 UI 交互与本地化文案，不顺手重写页面结构

- [ ] **Step 4: 运行相关测试**

Run: `uv run pytest tests/api/test_api_client.py tests/base/test_cli_manager.py -v`
Expected: PASS，确认 UI 适配层已建立且 CLI 行为未被误伤

- [ ] **Step 5: 提交**

```bash
git add frontend/ProjectPage.py frontend/AppFluentWindow.py api/client/ApiStateStore.py tests/api/test_api_client.py tests/base/test_cli_manager.py
git commit -m "refactor: route project ui through api client"
```

### Task 5: 建立 `TaskAppService`，打通翻译与分析任务 API

**Files:**
- Create: `api/contract/TaskDtos.py`
- Create: `api/application/TaskAppService.py`
- Create: `api/server/routes/TaskRoutes.py`
- Create: `api/client/TaskApiClient.py`
- Create: `tests/api/test_task_app_service.py`
- Modify: `module/Engine/Engine.py`
- Modify: `module/Data/DataManager.py`

- [ ] **Step 1: 写失败测试，固定启动任务只返回 accepted 与任务摘要**

```python
def test_start_translation_returns_accepted(task_app_service):
    result = task_app_service.start_translation({"mode": "NEW"})
    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_task_app_service.py::test_start_translation_returns_accepted -v`
Expected: FAIL，提示任务用例接口不存在或返回格式不正确

- [ ] **Step 3: 实现最小任务用例层**

要求：

- `start_translation` / `stop_translation` / `start_analysis` / `stop_analysis` 统一收口在 `TaskAppService`
- 返回值只描述“命令是否已接受”和任务摘要
- 真正进度与完成态通过 `EventBridge` + `SSE` 发出
- 不在路由层直接构造 `Base.Event`

- [ ] **Step 4: 运行任务 API 测试**

Run: `uv run pytest tests/api/test_task_app_service.py tests/api/test_event_bridge.py -v`
Expected: PASS，确认命令与事件模型配合正常

- [ ] **Step 5: 提交**

```bash
git add api/contract/TaskDtos.py api/application/TaskAppService.py api/server/routes/TaskRoutes.py api/client/TaskApiClient.py tests/api/test_task_app_service.py
git commit -m "feat: add task application service"
```

### Task 6: 改造翻译与分析页面走任务 API + SSE

**Files:**
- Modify: `frontend/Translation/TranslationPage.py`
- Modify: `frontend/Analysis/AnalysisPage.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `api/client/ApiStateStore.py`
- Modify: `tests/api/test_api_client.py`

- [ ] **Step 1: 写失败测试，固定页面通过 `TaskApiClient` 发命令**

```python
def test_translation_page_uses_task_api_client(mocker):
    client = mocker.Mock()
    page = build_translation_page(task_client=client)
    page.start_translation()
    client.start_translation.assert_called_once()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_client.py -k translation_page -v`
Expected: FAIL，提示页面仍直连旧事件或旧引擎入口

- [ ] **Step 3: 实现最小 UI 改造**

要求：

- 启动/停止任务统一通过 `TaskApiClient`
- busy 状态来自 `ApiStateStore` 中的任务快照
- 进度显示通过 SSE topic 更新，不再直接订阅内部 `Base.Event.TRANSLATION_PROGRESS`
- 尽量保留现有控件与用户路径

- [ ] **Step 4: 运行相关测试**

Run: `uv run pytest tests/api/test_api_client.py tests/module/engine/test_engine.py -v`
Expected: PASS，确认 UI 任务入口切换成功且引擎核心行为未回归

- [ ] **Step 5: 提交**

```bash
git add frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/AppFluentWindow.py api/client/ApiStateStore.py tests/api/test_api_client.py
git commit -m "refactor: route task pages through api client"
```

### Task 7: 建立 `WorkbenchAppService` 并改造工作台页面

**Files:**
- Create: `api/contract/WorkbenchDtos.py`
- Create: `api/application/WorkbenchAppService.py`
- Create: `api/server/routes/WorkbenchRoutes.py`
- Create: `api/client/WorkbenchApiClient.py`
- Create: `tests/api/test_workbench_app_service.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `module/Data/DataManager.py`

- [ ] **Step 1: 写失败测试，固定工作台快照与文件操作协议**

```python
def test_build_workbench_snapshot_returns_serializable_payload(workbench_app_service):
    result = workbench_app_service.get_snapshot({})
    assert "entries" in result["snapshot"]
    assert isinstance(result["snapshot"]["entries"], list)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_workbench_app_service.py::test_build_workbench_snapshot_returns_serializable_payload -v`
Expected: FAIL，提示 `WorkbenchAppService` 不存在或返回 `WorkbenchSnapshot` 原对象

- [ ] **Step 3: 实现最小用例层与页面改造**

要求：

- `WorkbenchSnapshot` 在用例层转换为纯 JSON DTO
- 工作台文件增删改接口统一走 `WorkbenchApiClient`
- 页面刷新来源切换为 `workbench.snapshot_changed` 与显式 API 查询
- 避免 UI 再直接调用 `DataManager.schedule_*_file`

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_workbench_app_service.py tests/module/data/test_workbench_service.py -v`
Expected: PASS，确认快照序列化与原工作台逻辑都保持正常

- [ ] **Step 5: 提交**

```bash
git add api/contract/WorkbenchDtos.py api/application/WorkbenchAppService.py api/server/routes/WorkbenchRoutes.py api/client/WorkbenchApiClient.py frontend/Workbench/WorkbenchPage.py tests/api/test_workbench_app_service.py
git commit -m "feat: add workbench api integration"
```

### Task 8: 建立 `SettingsAppService`，迁移设置入口并收口残留直连

**Files:**
- Create: `api/application/SettingsAppService.py`
- Create: `api/server/routes/SettingsRoutes.py`
- Create: `api/client/SettingsApiClient.py`
- Create: `tests/api/test_settings_app_service.py`
- Modify: `frontend/AppSettingsPage.py`
- Modify: `frontend/Setting/BasicSettingsPage.py`
- Modify: `frontend/Setting/ExpertSettingsPage.py`
- Modify: `frontend/AppFluentWindow.py`

- [ ] **Step 1: 写失败测试，固定设置读取与保存的 DTO**

```python
def test_get_app_settings_returns_json_snapshot(settings_app_service):
    result = settings_app_service.get_app_settings({})
    assert "theme" in result["settings"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_settings_app_service.py::test_get_app_settings_returns_json_snapshot -v`
Expected: FAIL，提示设置用例层未实现

- [ ] **Step 3: 实现最小设置 API 与页面切换**

要求：

- 设置页通过 `SettingsApiClient` 读写配置
- 配置变更后由 SSE 发出 `settings.changed`
- 仍保留当前本地化文本和现有交互，不引入额外界面重构

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_settings_app_service.py tests/module/test_config.py -v`
Expected: PASS，确认配置读写契约稳定

- [ ] **Step 5: 提交**

```bash
git add api/application/SettingsAppService.py api/server/routes/SettingsRoutes.py api/client/SettingsApiClient.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py tests/api/test_settings_app_service.py
git commit -m "feat: add settings api integration"
```

### Task 9: 编写 `api/SPEC.md` 并补齐边界约束

**Files:**
- Create: `api/SPEC.md`
- Modify: `docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md`
- Modify: `tests/api/test_core_api_server.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: 写失败测试，固定 `api/SPEC.md` 提到的关键接口必须存在**

```python
def test_required_api_paths_are_registered(route_map):
    assert "/api/project/load" in route_map
    assert "/api/tasks/translation/start" in route_map
    assert "/api/events/stream" in route_map
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_core_api_server.py -k required_api_paths -v`
Expected: FAIL，如果前面任务未全部完成或路由尚未注册完整

- [ ] **Step 3: 写 `api/SPEC.md`**

要求：

- 文档必须简洁
- 覆盖边界原则、接口目录、请求体示例、响应体示例、SSE topic、错误格式
- 明确新功能不得绕过 `api.client`

建议骨架：

```md
# API Contract
## Boundary Rules
## HTTP Endpoints
## SSE Topics
## Error Format
## Migration Notes
```

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_core_api_server.py -v`
Expected: PASS，接口注册与文档契约一致

- [ ] **Step 5: 提交**

```bash
git add api/SPEC.md docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md tests/api/test_core_api_server.py pyproject.toml
git commit -m "docs: add api contract spec"
```

### Task 10: 清理残留直连依赖并完成最终验证

**Files:**
- Modify: `frontend/**/*.py`
- Modify: `app.py`
- Modify: `base/CLIManager.py`
- Modify: `tests/api/*.py`
- Modify: `tests/base/test_cli_manager.py`

- [ ] **Step 1: 扫描 `frontend` 中残留的 `module.` / `base.` 直连依赖**

Run: `rg -n "from (module|base)\\.|import (module|base)\\." frontend`
Expected: 只剩纯 UI 必需依赖；不再出现 `DataManager`、`Engine`、`EventManager` 直连

- [ ] **Step 2: 写补充失败测试，固定边界规则**

```python
def test_frontend_does_not_import_data_manager_directly():
    ...
```

- [ ] **Step 3: 清理残留兼容胶水**

要求：

- 删除只为过渡而保留但已无调用方的 UI 直连逻辑
- 若 CLI 暂不迁到 API，则明确注释“CLI 仍为内部入口，不属于 UI 边界”
- 保持 `frontend` 只通过 `api.client` 与 Core 通信

- [ ] **Step 4: 运行最终验证**

Run: `uv run pytest tests/api tests/base/test_cli_manager.py tests/module/data/test_data_manager.py tests/module/engine/test_engine.py -v`
Expected: PASS

Run: `uv run pytest -v`
Expected: PASS 或仅有与本次改造无关的已知失败

Run: `uv run ruff format app.py api tests/api frontend`
Expected: 所有变更文件格式化完成

Run: `uv run ruff check --fix app.py api tests/api frontend`
Expected: 无阻塞性 lint 错误

- [ ] **Step 5: 提交**

```bash
git add app.py api frontend base/CLIManager.py tests
git commit -m "refactor: complete frontend core api boundary"
```

## 3. 执行说明

### 3.1 推荐执行顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9
10. Task 10

### 3.2 中途停机点

以下任务完成后即可形成可演示阶段成果：

- Task 2 结束后：可展示最小服务与 SSE 架子
- Task 4 结束后：可展示工程生命周期改走 API
- Task 6 结束后：可展示任务主链路改走 API
- Task 7 结束后：可展示工作台主链路改走 API
- Task 10 结束后：可展示边界切断后的第一阶段完成态

### 3.3 执行注意事项

- 若发现 `api/server` 需要引入轻量 Web 框架，必须先核对仓库是否已有依赖；无必要时优先使用标准库或现有依赖。
- 若 `SSE` 客户端实现需要额外线程，必须通过 UI 层安全回调更新页面，不允许后台线程直接操作 Qt 控件。
- 若计划中某些页面迁移范围明显超过单次可控 diff，应再拆子任务，但不得绕过 `api/application` 直连内部对象。
- 若实现阶段决定让 CLI 也逐步复用 `api/application`，应单独追加计划，不要在本计划中顺手扩散范围。

## 4. 完成定义

以下条件全部满足，才算本计划第一阶段完成：

- `frontend` 主链路页面不再直连 `DataManager`、`Engine`、`EventManager`
- 工程生命周期、任务主链路、工作台主链路都通过 `api.client` 调用 Core
- `EventBridge` 对外只暴露标准化 topic
- `GET /api/events/stream` 可稳定接收事件
- 业务接口统一采用 `POST + JSON body`
- `api/SPEC.md` 已写好并与实际接口保持一致
- 自动化测试通过，最小手工回归路径通过
