# Frontend Core Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `api/` 下建立 UI 与 Core 的本地 HTTP/SSE 边界，并在第一阶段只迁移工程生命周期、翻译/分析主链路、工作台主链路与应用设置入口，为后续 `Quality` / `Proofreading` / `Extra` 页面迁移打好稳定协议基础。

**Architecture:** 先在 `api/Application` 建立稳定的命令/查询用例层，再由 `api/Server` 暴露本地 `POST + JSON` 与 `GET /api/events/stream`。UI 侧通过 `api.Client` 与 `ApiStateStore` 先做首屏快照拉取，再合并 `SSE` 增量事件；现有 `module/` 与 `base/` 继续承载核心实现，但不再作为第一阶段目标页面的直接数据入口。

**Tech Stack:** Python 3.14、PySide6、httpx、pytest、现有 `DataManager` / `Engine` / `EventManager`

---

## 0. 文件结构映射

### 新建目录与文件

- Create: `api/__init__.py`
- Create: `api/Contract/__init__.py`
- Create: `api/Contract/ApiError.py`
- Create: `api/Contract/ApiResponse.py`
- Create: `api/Contract/EventEnvelope.py`
- Create: `api/Contract/ProjectDtos.py`
- Create: `api/Contract/TaskDtos.py`
- Create: `api/Contract/WorkbenchDtos.py`
- Create: `api/Application/__init__.py`
- Create: `api/Application/AppContext.py`
- Create: `api/Application/ProjectAppService.py`
- Create: `api/Application/TaskAppService.py`
- Create: `api/Application/WorkbenchAppService.py`
- Create: `api/Application/SettingsAppService.py`
- Create: `api/Application/EventStreamService.py`
- Create: `api/Bridge/__init__.py`
- Create: `api/Bridge/EventTopic.py`
- Create: `api/Bridge/EventBridge.py`
- Create: `api/Server/__init__.py`
- Create: `api/Server/CoreApiServer.py`
- Create: `api/Server/ServerBootstrap.py`
- Create: `api/Server/Routes/__init__.py`
- Create: `api/Server/Routes/EventRoutes.py`
- Create: `api/Server/Routes/ProjectRoutes.py`
- Create: `api/Server/Routes/TaskRoutes.py`
- Create: `api/Server/Routes/WorkbenchRoutes.py`
- Create: `api/Server/Routes/SettingsRoutes.py`
- Create: `api/Client/__init__.py`
- Create: `api/Client/ApiClient.py`
- Create: `api/Client/ProjectApiClient.py`
- Create: `api/Client/TaskApiClient.py`
- Create: `api/Client/WorkbenchApiClient.py`
- Create: `api/Client/SettingsApiClient.py`
- Create: `api/Client/SseClient.py`
- Create: `api/Client/ApiStateStore.py`
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
- Create: `tests/api/test_api_state_store.py`
- Create: `api/SPEC.md`

### 重点修改文件

- Modify: `app.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/ProjectPage.py`
- Modify: `frontend/Translation/TranslationPage.py`
- Modify: `frontend/Analysis/AnalysisPage.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `frontend/AppSettingsPage.py`
- Modify: `frontend/Setting/BasicSettingsPage.py`
- Modify: `frontend/Setting/ExpertSettingsPage.py`
- Modify: `base/CLIManager.py`

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
- 先为 `api/Application` 和 `api/Bridge` 建测试，再写最小实现。
- 每个任务完成后都要运行该任务对应的最小测试集合。
- 每个任务完成后都要单独提交，避免超大 diff。

### 第一阶段范围

- 纳入本阶段：`frontend/AppFluentWindow.py`、`frontend/ProjectPage.py`、`frontend/Translation/TranslationPage.py`、`frontend/Analysis/AnalysisPage.py`、`frontend/Workbench/WorkbenchPage.py`、`frontend/AppSettingsPage.py`、`frontend/Setting/BasicSettingsPage.py`、`frontend/Setting/ExpertSettingsPage.py`
- 暂不纳入本阶段：`frontend/Proofreading/**`、`frontend/Quality/**`、`frontend/Model/**`、`frontend/Extra/**` 的迁移改造
- CLI 仍然作为内部入口保留，不属于本阶段“UI 必须通过 `api.Client` 访问 Core”的边界约束
- 第二阶段若要迁移 `Quality` / `Proofreading` / `Extra`，需基于本计划产出的 `api/Application` 与 `api/Client` 契约单独追加计划

## 1. 里程碑拆分

| 里程碑 | 闭环结果 |
| --- | --- |
| `M1` | 本地 Core 服务可启动、关闭且不影响 CLI，`/api/health` 与 `/api/events/stream` 可用 |
| `M2` | 工程生命周期与工程快照查询可通过 `api.Client` 调用 |
| `M3` | 任务命令与任务快照查询可通过 API 获取，`ApiStateStore` 可完成首屏 hydration |
| `M4` | 翻译/分析页面完成迁移，并通过 `SSE` 更新任务状态 |
| `M5` | 工作台与应用设置入口完成迁移，第一阶段目标页面不再直连 Core 单例 |
| `M6` | `api/SPEC.md` 完成，第一阶段边界规则通过精确验证并形成可继续扩展的基线 |

## 2. 任务清单

### Task 1: 搭建 `api` 骨架与最小协议测试

**Files:**
- Create: `api/__init__.py`
- Create: `api/Contract/ApiError.py`
- Create: `api/Contract/ApiResponse.py`
- Create: `api/Contract/EventEnvelope.py`
- Create: `api/Server/CoreApiServer.py`
- Create: `api/Server/ServerBootstrap.py`
- Create: `tests/api/test_core_api_server.py`

- [ ] **Step 1: 写失败测试，固定最小服务协议**

```python
import httpx

from api.Server.ServerBootstrap import ServerBootstrap


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
git add api tests/api/test_core_api_server.py
git commit -m "feat: add api server skeleton"
```

### Task 2: 建立 `EventBridge` 与 `EventStreamService`

**Files:**
- Create: `api/Bridge/EventTopic.py`
- Create: `api/Bridge/EventBridge.py`
- Create: `api/Application/EventStreamService.py`
- Create: `api/Server/Routes/EventRoutes.py`
- Create: `tests/api/test_event_bridge.py`
- Create: `tests/api/test_event_stream_service.py`
- Modify: `base/Base.py`

- [ ] **Step 1: 写失败测试，固定内部事件到外部 topic 的映射**

```python
from base.Base import Base
from api.Bridge.EventBridge import EventBridge


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
git add api/Bridge api/Application/EventStreamService.py api/Server/Routes/EventRoutes.py tests/api/test_event_bridge.py tests/api/test_event_stream_service.py
git commit -m "feat: add api event bridge and stream service"
```

### Task 3: 建立 `ProjectAppService` 并补齐 UI 模式 Core 服务生命周期

**Files:**
- Create: `api/Contract/ProjectDtos.py`
- Create: `api/Application/ProjectAppService.py`
- Create: `api/Server/Routes/ProjectRoutes.py`
- Create: `api/Client/ApiClient.py`
- Create: `api/Client/ProjectApiClient.py`
- Create: `tests/api/test_project_app_service.py`
- Create: `tests/api/test_api_client.py`
- Modify: `app.py`
- Modify: `tests/api/test_core_api_server.py`
- Modify: `tests/base/test_cli_manager.py`

- [ ] **Step 1: 写失败测试，固定工程 DTO 与 UI/CLI 生命周期边界**

```python
def test_load_project_returns_loaded_snapshot(project_app_service, lg_path):
    result = project_app_service.load_project({"path": lg_path})
    assert result["project"]["path"] == lg_path
    assert result["project"]["loaded"] is True


def test_cli_mode_does_not_start_local_api_server(cli_entry_runner):
    result = cli_entry_runner()
    assert result.server_started is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_project_app_service.py tests/api/test_core_api_server.py tests/base/test_cli_manager.py -v`
Expected: FAIL，提示 `ProjectAppService` / 生命周期隔离逻辑尚未实现

- [ ] **Step 3: 写最小实现**

```python
class ProjectAppService:
    def load_project(self, request: dict[str, str]) -> dict[str, object]:
        ...

    def create_project(self, request: dict[str, str]) -> dict[str, object]:
        ...
```

要求：

- 用例层负责把 `DataManager` 调用整理成稳定 DTO，不把内部返回值直接抛给客户端
- `app.py` 只在 UI 模式启动本地 Core 服务，并在 `aboutToQuit` 中统一关闭服务、再卸载工程、最后关闭日志
- CLI 保持旧行为，不通过本地 HTTP 调自己，也不因为新增服务而改变退出码语义

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/api/test_project_app_service.py tests/api/test_api_client.py tests/api/test_core_api_server.py tests/base/test_cli_manager.py -v`
Expected: PASS，确认工程接口可用且 UI/CLI 生命周期边界稳定

- [ ] **Step 5: 提交**

```bash
git add app.py api/Client api/Contract/ProjectDtos.py api/Application/ProjectAppService.py api/Server/Routes/ProjectRoutes.py tests/api/test_project_app_service.py tests/api/test_api_client.py tests/api/test_core_api_server.py tests/base/test_cli_manager.py
git commit -m "feat: add project api service and ui server lifecycle"
```

### Task 4: 建立工程快照查询契约与 `ApiStateStore` 基础版

**Files:**
- Create: `api/Application/AppContext.py`
- Create: `api/Client/ApiStateStore.py`
- Create: `tests/api/test_api_state_store.py`
- Modify: `api/Application/ProjectAppService.py`
- Modify: `api/Server/Routes/ProjectRoutes.py`
- Modify: `api/Client/ProjectApiClient.py`
- Modify: `tests/api/test_project_app_service.py`

- [ ] **Step 1: 写失败测试，固定“首屏快照 + 本地状态缓存”契约**

```python
def test_get_project_snapshot_returns_serializable_state(project_app_service):
    result = project_app_service.get_project_snapshot({})
    assert "loaded" in result["project"]


def test_api_state_store_hydrates_project_snapshot():
    store = ApiStateStore()
    store.hydrate_project({"loaded": True, "path": "demo.lg"})
    assert store.is_project_loaded() is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_project_app_service.py tests/api/test_api_state_store.py -v`
Expected: FAIL，提示缺少快照查询或 `ApiStateStore` 尚未实现

- [ ] **Step 3: 写最小实现**

要求：

- `ProjectAppService` 新增显式快照查询接口，供 UI 首屏 hydration 使用
- `ProjectApiClient` 提供 `get_project_snapshot()`，`ApiStateStore` 只保存序列化后的不可变快照数据
- `ApiStateStore` 先支持工程加载态、工程路径、工程关闭后的重置行为，不提前塞入尚未落地的工作台/设置细节

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/api/test_project_app_service.py tests/api/test_api_state_store.py tests/api/test_api_client.py -v`
Expected: PASS，确认工程快照可查询且 UI 侧有单一缓存入口

- [ ] **Step 5: 提交**

```bash
git add api/Application/AppContext.py api/Client/ApiStateStore.py api/Application/ProjectAppService.py api/Server/Routes/ProjectRoutes.py api/Client/ProjectApiClient.py tests/api/test_project_app_service.py tests/api/test_api_state_store.py tests/api/test_api_client.py
git commit -m "feat: add project snapshot query and api state store"
```

### Task 5: 改造 `ProjectPage` 与 `AppFluentWindow` 走工程 API

**Files:**
- Modify: `frontend/ProjectPage.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `tests/api/test_api_client.py`
- Modify: `tests/base/test_cli_manager.py`

- [ ] **Step 1: 写失败测试，固定 UI 不再直连 `DataManager`**

```python
from unittest.mock import Mock


def test_project_page_uses_project_api_client():
    client = Mock()
    page = build_project_page(project_client=client)
    page.on_open_project()
    client.load_project.assert_called_once()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_client.py -k project_page -v`
Expected: FAIL，提示页面仍依赖旧入口或构造方式不支持注入客户端

- [ ] **Step 3: 实现最小改造**

要求：

- `ProjectPage` 的创建、预览、打开流程统一通过 `ProjectApiClient`
- `AppFluentWindow` 的导航禁用态、页面跳转重定向、工程关闭后的状态恢复改为读取 `ApiStateStore`
- 允许继续订阅全局 `TOAST` / `PROGRESS_TOAST` / 更新相关事件，但不得再直接读取 `DataManager.get().is_loaded()`

- [ ] **Step 4: 运行相关测试**

Run: `uv run pytest tests/api/test_api_client.py tests/api/test_api_state_store.py tests/base/test_cli_manager.py -v`
Expected: PASS，确认工程 UI 已切到 API 适配层且 CLI 行为未被误伤

- [ ] **Step 5: 提交**

```bash
git add frontend/ProjectPage.py frontend/AppFluentWindow.py api/Client/ApiStateStore.py tests/api/test_api_client.py tests/api/test_api_state_store.py tests/base/test_cli_manager.py
git commit -m "refactor: route project ui through api client"
```

### Task 6: 建立 `TaskAppService`、任务快照查询与状态仓库扩展

**Files:**
- Create: `api/Contract/TaskDtos.py`
- Create: `api/Application/TaskAppService.py`
- Create: `api/Server/Routes/TaskRoutes.py`
- Create: `api/Client/TaskApiClient.py`
- Create: `tests/api/test_task_app_service.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `module/Engine/Engine.py`
- Modify: `module/Data/DataManager.py`

- [ ] **Step 1: 写失败测试，固定“命令 accepted + 任务快照查询”契约**

```python
def test_start_translation_returns_accepted(task_app_service):
    result = task_app_service.start_translation({"mode": "NEW"})
    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"


def test_get_task_snapshot_returns_current_status(task_app_service):
    result = task_app_service.get_task_snapshot({})
    assert "status" in result["task"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_task_app_service.py tests/api/test_api_state_store.py -v`
Expected: FAIL，提示任务用例层或任务快照接口未实现

- [ ] **Step 3: 实现最小任务用例层**

要求：

- `start_translation` / `stop_translation` / `start_analysis` / `stop_analysis` 统一收口在 `TaskAppService`
- 命令接口返回值只描述“命令是否已接受”和任务摘要；当前状态查询走单独的 `get_task_snapshot`
- `ApiStateStore` 扩展任务状态、busy 状态、最近一次进度快照，并支持“HTTP 首屏 hydration + SSE 增量合并”
- 不在路由层直接构造 `Base.Event`，所有内部事件桥接统一经 `EventBridge`

- [ ] **Step 4: 运行任务 API 测试**

Run: `uv run pytest tests/api/test_task_app_service.py tests/api/test_api_state_store.py tests/api/test_event_bridge.py -v`
Expected: PASS，确认命令模型与查询模型职责清晰

- [ ] **Step 5: 提交**

```bash
git add api/Contract/TaskDtos.py api/Application/TaskAppService.py api/Server/Routes/TaskRoutes.py api/Client/TaskApiClient.py api/Client/ApiStateStore.py tests/api/test_task_app_service.py tests/api/test_api_state_store.py
git commit -m "feat: add task api service and snapshot query"
```

### Task 7: 改造翻译与分析页面走任务 API + `SSE`

**Files:**
- Modify: `frontend/Translation/TranslationPage.py`
- Modify: `frontend/Analysis/AnalysisPage.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `tests/api/test_api_client.py`

- [ ] **Step 1: 写失败测试，固定页面通过 `TaskApiClient` 发命令**

```python
from unittest.mock import Mock


def test_translation_page_uses_task_api_client():
    client = Mock()
    page = build_translation_page(task_client=client)
    page.start_translation()
    client.start_translation.assert_called_once()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_client.py -k translation_page -v`
Expected: FAIL，提示页面仍直连旧引擎入口或旧进度事件

- [ ] **Step 3: 实现最小 UI 改造**

要求：

- 启动/停止任务统一通过 `TaskApiClient`，页面首屏状态来自 `ApiStateStore`
- busy 状态、按钮启用态、进度环、统计卡片全部改为消费任务快照与 `SSE` topic
- 允许保留 `TOAST` / `PROGRESS_TOAST` 等纯 UI 事件，但不得再直接依赖 `Engine.get()` 或 `Base.Event.TRANSLATION_PROGRESS`
- 继续保留现有控件与本地化文案，不顺手重写页面结构

- [ ] **Step 4: 运行相关测试**

Run: `uv run pytest tests/api/test_api_client.py tests/api/test_api_state_store.py tests/module/engine/test_engine.py -v`
Expected: PASS，确认 UI 任务入口切换成功且引擎核心行为未回归

- [ ] **Step 5: 提交**

```bash
git add frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/AppFluentWindow.py api/Client/ApiStateStore.py tests/api/test_api_client.py tests/api/test_api_state_store.py
git commit -m "refactor: route task pages through api client"
```

### Task 8: 建立 `WorkbenchAppService` 并改造工作台页面

**Files:**
- Create: `api/Contract/WorkbenchDtos.py`
- Create: `api/Application/WorkbenchAppService.py`
- Create: `api/Server/Routes/WorkbenchRoutes.py`
- Create: `api/Client/WorkbenchApiClient.py`
- Create: `tests/api/test_workbench_app_service.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `api/Client/ApiStateStore.py`
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

- `WorkbenchSnapshot` 在用例层转换为纯 JSON DTO，显式区分“主动查询快照”和“事件驱动刷新”
- 工作台文件增删改、导出、刷新统一走 `WorkbenchApiClient`
- `WorkbenchPage` 的加载态与任务忙碌态从 `ApiStateStore` 读取，不再直接调用 `DataManager.get()` / `Engine.get()`
- 页面刷新来源切换为 `workbench.snapshot_changed` 与显式 API 查询，避免 UI 继续直接调用 `DataManager.schedule_*_file`

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_workbench_app_service.py tests/api/test_api_state_store.py tests/module/data/test_workbench_service.py -v`
Expected: PASS，确认快照序列化与原工作台逻辑都保持正常

- [ ] **Step 5: 提交**

```bash
git add api/Contract/WorkbenchDtos.py api/Application/WorkbenchAppService.py api/Server/Routes/WorkbenchRoutes.py api/Client/WorkbenchApiClient.py api/Client/ApiStateStore.py frontend/Workbench/WorkbenchPage.py tests/api/test_workbench_app_service.py tests/api/test_api_state_store.py
git commit -m "feat: add workbench api integration"
```

### Task 9: 迁移应用设置入口并补齐 `api/SPEC.md`

**Files:**
- Create: `api/Application/SettingsAppService.py`
- Create: `api/Server/Routes/SettingsRoutes.py`
- Create: `api/Client/SettingsApiClient.py`
- Create: `tests/api/test_settings_app_service.py`
- Create: `api/SPEC.md`
- Modify: `frontend/AppSettingsPage.py`
- Modify: `frontend/Setting/BasicSettingsPage.py`
- Modify: `frontend/Setting/ExpertSettingsPage.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md`
- Modify: `tests/api/test_core_api_server.py`

- [ ] **Step 1: 写失败测试，固定设置快照与文档契约**

```python
def test_get_app_settings_returns_json_snapshot(settings_app_service):
    result = settings_app_service.get_app_settings({})
    assert "theme" in result["settings"]


def test_required_api_paths_are_registered(route_map):
    assert "/api/project/snapshot" in route_map
    assert "/api/tasks/snapshot" in route_map
    assert "/api/events/stream" in route_map
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_settings_app_service.py tests/api/test_core_api_server.py -v`
Expected: FAIL，提示设置用例层或文档约定的路由尚未补齐

- [ ] **Step 3: 实现最小设置 API 与文档**

要求：

- 设置页通过 `SettingsApiClient` 读写配置，`ApiStateStore` 只缓存当前页面需要的设置快照
- 配置变更后由 `SSE` 发出 `settings.changed`，但不借机重构现有页面布局
- `api/SPEC.md` 必须覆盖边界原则、HTTP 查询/命令接口、`SSE` topic、错误格式、第一阶段纳入/排除范围，并明确新功能不得绕过 `api.Client`

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_settings_app_service.py tests/api/test_core_api_server.py tests/module/test_config.py -v`
Expected: PASS，确认配置读写契约与接口文档一致

- [ ] **Step 5: 提交**

```bash
git add api/Application/SettingsAppService.py api/Server/Routes/SettingsRoutes.py api/Client/SettingsApiClient.py api/SPEC.md frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py frontend/AppFluentWindow.py docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md tests/api/test_settings_app_service.py tests/api/test_core_api_server.py
git commit -m "feat: add settings api integration and contract spec"
```

### Task 10: 清理第一阶段残留直连依赖并完成最终验证

**Files:**
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/ProjectPage.py`
- Modify: `frontend/Translation/TranslationPage.py`
- Modify: `frontend/Analysis/AnalysisPage.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `frontend/AppSettingsPage.py`
- Modify: `frontend/Setting/BasicSettingsPage.py`
- Modify: `frontend/Setting/ExpertSettingsPage.py`
- Modify: `app.py`
- Modify: `base/CLIManager.py`
- Modify: `tests/api/*.py`
- Modify: `tests/base/test_cli_manager.py`

- [ ] **Step 1: 精确扫描第一阶段目标页面中的禁用直连依赖**

Run: `rg -n "from module\\.Data\\.DataManager import DataManager|from module\\.Engine\\.Engine import Engine|from base\\.EventManager import EventManager" frontend/AppFluentWindow.py frontend/ProjectPage.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py`
Expected: 无匹配；其他 `base.Base` / `base.BaseIcon` / `module.Localizer` 等纯 UI 合法依赖允许保留

- [ ] **Step 2: 写补充失败测试，固定第一阶段边界规则**

```python
def test_phase_one_pages_do_not_import_forbidden_core_singletons():
    ...
```

- [ ] **Step 3: 清理残留兼容胶水**

要求：

- 只清理第一阶段目标页面中的禁用直连依赖，不在本计划内顺手扩散到 `Proofreading` / `Quality` / `Extra`
- 若 CLI 暂不迁到 API，则明确注释“CLI 仍为内部入口，不属于 UI 边界”
- 删除已无调用方的第一阶段兼容胶水，保持第一阶段页面只通过 `api.Client` / `ApiStateStore` 与 Core 通信

- [ ] **Step 4: 运行最终验证**

Run: `uv run pytest tests/api tests/base/test_cli_manager.py tests/module/data/test_data_manager.py tests/module/engine/test_engine.py -v`
Expected: PASS

Run: `uv run pytest -v`
Expected: PASS 或仅有与本次改造无关的已知失败

Run: `uv run ruff format app.py api tests/api frontend/AppFluentWindow.py frontend/ProjectPage.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py`
Expected: 所有变更文件格式化完成

Run: `uv run ruff check --fix app.py api tests/api frontend/AppFluentWindow.py frontend/ProjectPage.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py`
Expected: 无阻塞性 lint 错误

- [ ] **Step 5: 提交**

```bash
git add app.py api frontend/AppFluentWindow.py frontend/ProjectPage.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py base/CLIManager.py tests
git commit -m "refactor: complete phase-one frontend core api boundary"
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

- Task 2 结束后：可展示最小服务、生命周期事件桥接与 `SSE` 骨架
- Task 4 结束后：可展示工程生命周期 API 与首屏快照 hydration
- Task 7 结束后：可展示翻译/分析主链路改走 API
- Task 8 结束后：可展示工作台主链路改走 API
- Task 10 结束后：可展示第一阶段页面边界切断后的完成态

### 3.3 执行注意事项

- 若发现 `api/Server` 需要引入轻量 Web 框架，必须先核对仓库是否已有依赖；无必要时优先使用标准库或现有依赖。
- 若 `SSE` 客户端实现需要额外线程，必须通过 UI 层安全回调更新页面，不允许后台线程直接操作 Qt 控件。
- 若计划中某些页面迁移范围明显超过单次可控 diff，应再拆子任务，但不得绕过 `api/Application` 直连内部对象。
- `ApiStateStore` 只缓存 UI 当前真正需要的序列化快照，避免把内部可变对象引用穿过边界。
- 第一阶段边界检查只针对已纳入范围的页面；`Proofreading` / `Quality` / `Model` / `Extra` 仍维持现状，后续单独规划。
- 若实现阶段决定让 CLI 也逐步复用 `api/Application`，应单独追加计划，不要在本计划中顺手扩散范围。

## 4. 完成定义

以下条件全部满足，才算本计划第一阶段完成：

- `frontend/AppFluentWindow.py`、`frontend/ProjectPage.py`、`frontend/Translation/TranslationPage.py`、`frontend/Analysis/AnalysisPage.py`、`frontend/Workbench/WorkbenchPage.py`、`frontend/AppSettingsPage.py`、`frontend/Setting/BasicSettingsPage.py`、`frontend/Setting/ExpertSettingsPage.py` 不再直连 `DataManager`、`Engine`、`EventManager`
- 工程生命周期、任务命令与任务快照查询、工作台主链路、应用设置入口都通过 `api.Client` 调用 Core
- `ApiStateStore` 可通过 HTTP 快照完成首屏 hydration，并通过 `SSE` 合并后续状态更新
- `EventBridge` 对外只暴露标准化 topic
- `GET /api/events/stream` 可稳定接收事件
- UI 模式可启动并关闭本地 Core 服务，CLI 模式不依赖该服务且退出行为保持稳定
- 业务接口统一采用 `POST + JSON body`
- `api/SPEC.md` 已写好并与实际接口保持一致，且明确记录第一阶段纳入范围与排除范围
- 自动化测试通过，最小手工回归路径通过
