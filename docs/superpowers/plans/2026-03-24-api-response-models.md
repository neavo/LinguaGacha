# API 响应对象化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Core API 响应在客户端边界立即反序列化为 `model/Api/` 下的冻结对象，并把 `ApiStateStore` 改为缓存对象而非 `dict`。

**Architecture:** 保留 HTTP 边界继续使用 JSON / `dict`，由各业务 `ApiClient` 负责 `from_dict()` 反序列化。`ApiStateStore` 只持有 `Snapshot` / `Update` 对象并通过对象方法合并增量，页面与窗口层全面退出 `response.get(...)` / `snapshot.get(...)` 读取模式。

**Tech Stack:** Python 3.14, PySide6, httpx, pytest, Ruff

---

## 文件结构

### 新建文件

- `model/Api/__init__.py`
- `model/Api/SettingsModels.py`
- `model/Api/ProjectModels.py`
- `model/Api/WorkbenchModels.py`
- `model/Api/TaskModels.py`
- `tests/model/api/test_settings_models.py`
- `tests/model/api/test_project_models.py`
- `tests/model/api/test_workbench_models.py`
- `tests/model/api/test_task_models.py`

### 重点修改文件

- `api/Client/SettingsApiClient.py`
- `api/Client/ProjectApiClient.py`
- `api/Client/WorkbenchApiClient.py`
- `api/Client/TaskApiClient.py`
- `api/Client/ApiStateStore.py`
- `api/Client/SseClient.py`
- `frontend/AppFluentWindow.py`
- `frontend/AppSettingsPage.py`
- `frontend/Setting/BasicSettingsPage.py`
- `frontend/Setting/ExpertSettingsPage.py`
- `frontend/ProjectPage.py`
- `frontend/Workbench/WorkbenchPage.py`
- `frontend/Translation/TranslationPage.py`
- `frontend/Analysis/AnalysisPage.py`
- `tests/api/test_api_client.py`
- `tests/api/test_api_state_store.py`

### 参考文件

- `docs/superpowers/specs/2026-03-24-api-response-models-design.md`
- `api/Application/SettingsAppService.py`
- `api/Application/ProjectAppService.py`
- `api/Application/WorkbenchAppService.py`
- `api/Application/TaskAppService.py`
- `api/Bridge/EventTopic.py`

## 任务拆分

### Task 1: 建立 `model/Api` 基础模型与单元测试

**Files:**
- Create: `model/Api/__init__.py`
- Create: `model/Api/SettingsModels.py`
- Create: `model/Api/ProjectModels.py`
- Create: `model/Api/WorkbenchModels.py`
- Create: `model/Api/TaskModels.py`
- Test: `tests/model/api/test_settings_models.py`
- Test: `tests/model/api/test_project_models.py`
- Test: `tests/model/api/test_workbench_models.py`
- Test: `tests/model/api/test_task_models.py`

- [ ] **Step 1: 先写 Settings / Project / Workbench / Task 模型测试**

```python
from model.Api.SettingsModels import AppSettingsSnapshot
from model.Api.TaskModels import TaskProgressUpdate
from model.Api.TaskModels import TaskSnapshot


def test_app_settings_snapshot_from_dict_normalizes_recent_projects() -> None:
    snapshot = AppSettingsSnapshot.from_dict(
        {
            "app_language": "ZH",
            "target_language": "EN",
            "recent_projects": [{"path": "demo.lg", "name": "Demo"}],
        }
    )

    assert snapshot.app_language == "ZH"
    assert snapshot.recent_projects[0].path == "demo.lg"


def test_task_snapshot_merge_progress_preserves_existing_status() -> None:
    snapshot = TaskSnapshot.from_dict(
        {"task_type": "translation", "status": "TRANSLATING", "busy": True, "line": 1}
    )

    merged = snapshot.merge_progress(
        TaskProgressUpdate.from_dict({"line": 3, "total_input_tokens": 9})
    )

    assert merged.status == "TRANSLATING"
    assert merged.line == 3
    assert merged.total_input_tokens == 9
```

- [ ] **Step 2: 运行模型测试并确认失败**

Run: `uv run pytest tests/model/api -v`
Expected: FAIL，提示 `model.Api` 模块或相关类不存在。

- [ ] **Step 3: 实现最小模型集**

```python
@dataclass(frozen=True)
class RecentProjectEntry:
    path: str
    name: str

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "RecentProjectEntry":
        normalized = data if isinstance(data, dict) else {}
        return cls(
            path=str(normalized.get("path", "")),
            name=str(normalized.get("name", "")),
        )
```

实现要点：

- `AppSettingsSnapshot` 负责归一化基础设置与 `recent_projects`。
- `ProjectSnapshot` / `ProjectPreview` 负责项目快照与预览。
- `WorkbenchFileEntry` / `WorkbenchSnapshot` 负责条目列表转 `tuple`。
- `TaskSnapshot`、`TaskStatusUpdate`、`TaskProgressUpdate` 分离建模。
- `TaskSnapshot` 提供 `merge_status()` / `merge_progress()`。

- [ ] **Step 4: 运行模型测试并确认通过**

Run: `uv run pytest tests/model/api -v`
Expected: PASS，所有 `from_dict()` 与 `merge_xxx()` 用例通过。

- [ ] **Step 5: 格式化与检查模型文件**

Run: `uv run ruff format model/Api tests/model/api`
Run: `uv run ruff check --fix model/Api tests/model/api`
Expected: 无报错，格式化完成。

- [ ] **Step 6: 提交模型层基础改造**

```bash
git add model/Api tests/model/api
git commit -m "feat: add api response models"
```

### Task 2: 迁移 Settings 链路到对象化响应

**Files:**
- Modify: `api/Client/SettingsApiClient.py`
- Modify: `frontend/AppSettingsPage.py`
- Modify: `frontend/Setting/BasicSettingsPage.py`
- Modify: `frontend/Setting/ExpertSettingsPage.py`
- Modify: `frontend/ProjectPage.py`
- Modify: `tests/api/test_api_client.py`

- [ ] **Step 1: 先写 SettingsApiClient 与 Settings 页面测试**

```python
from model.Api.SettingsModels import AppSettingsSnapshot


def test_settings_api_client_get_app_settings_returns_snapshot(
    fake_settings_config,
) -> None:
    ...
    result = settings_client.get_app_settings()

    assert isinstance(result, AppSettingsSnapshot)
    assert result.request_timeout == 120
    assert result.target_language == "ZH"
```

补充页面测试断言：

- `ProjectPage.get_recent_projects()` 返回 `RecentProjectEntry` 信息投影后的页面数据。
- `BasicSettingsPage` / `ExpertSettingsPage` 能直接消费对象字段。

- [ ] **Step 2: 运行 Settings 相关测试并确认失败**

Run: `uv run pytest tests/api/test_api_client.py -k "settings or app_settings or basic_settings or expert_settings or project_page" -v`
Expected: FAIL，返回值类型仍是 `dict`。

- [ ] **Step 3: 在 SettingsApiClient 中返回 `AppSettingsSnapshot`**

```python
def get_app_settings(self) -> AppSettingsSnapshot:
    response = self.api_client.post(SettingsRoutes.SNAPSHOT_PATH, {})
    return AppSettingsSnapshot.from_dict(response.get("settings", {}))
```

同步修改：

- `update_app_settings()`、`add_recent_project()`、`remove_recent_project()` 返回 `AppSettingsSnapshot`
- `AppSettingsPage`、`BasicSettingsPage`、`ExpertSettingsPage` 的 `get_settings_snapshot()` / `update_settings()` 返回对象
- `ProjectPage.get_recent_projects()` 改为从 `AppSettingsSnapshot.recent_projects` 读取

- [ ] **Step 4: 运行 Settings 相关测试并确认通过**

Run: `uv run pytest tests/api/test_api_client.py -k "settings or app_settings or basic_settings or expert_settings or project_page" -v`
Expected: PASS，页面测试与客户端测试都改为对象断言。

- [ ] **Step 5: 格式化与检查 Settings 链路**

Run: `uv run ruff format api/Client/SettingsApiClient.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py frontend/ProjectPage.py tests/api/test_api_client.py`
Run: `uv run ruff check --fix api/Client/SettingsApiClient.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py frontend/ProjectPage.py tests/api/test_api_client.py`
Expected: 无报错。

- [ ] **Step 6: 提交 Settings 链路改造**

```bash
git add api/Client/SettingsApiClient.py frontend/AppSettingsPage.py frontend/Setting/BasicSettingsPage.py frontend/Setting/ExpertSettingsPage.py frontend/ProjectPage.py tests/api/test_api_client.py
git commit -m "refactor: objectify settings api responses"
```

### Task 3: 迁移 Project 与 Workbench 链路到对象化响应

**Files:**
- Modify: `api/Client/ProjectApiClient.py`
- Modify: `api/Client/WorkbenchApiClient.py`
- Modify: `frontend/ProjectPage.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `tests/api/test_api_client.py`

- [ ] **Step 1: 先写 Project / Workbench 客户端与页面测试**

```python
from model.Api.ProjectModels import ProjectSnapshot
from model.Api.WorkbenchModels import WorkbenchSnapshot


def test_project_api_client_get_project_snapshot_returns_snapshot(...) -> None:
    ...
    result = project_client.get_project_snapshot()
    assert isinstance(result, ProjectSnapshot)
    assert result.loaded is False


def test_workbench_api_client_get_snapshot_returns_snapshot(...) -> None:
    ...
    result = workbench_client.get_snapshot()
    assert isinstance(result, WorkbenchSnapshot)
    assert result.entries[0].rel_path == "script/a.txt"
```

- [ ] **Step 2: 运行 Project / Workbench 测试并确认失败**

Run: `uv run pytest tests/api/test_api_client.py -k "project_api_client or workbench_api_client or workbench_page" -v`
Expected: FAIL，返回值当前仍是 `dict`。

- [ ] **Step 3: 实现 Project / Workbench 对象化**

```python
def get_project_snapshot(self) -> ProjectSnapshot:
    response = self.api_client.post(ProjectRoutes.SNAPSHOT_PATH, {})
    return ProjectSnapshot.from_dict(response.get("project", {}))
```

```python
def get_snapshot(self) -> WorkbenchSnapshot:
    response = self.api_client.post(WorkbenchRoutes.SNAPSHOT_PATH, {})
    return WorkbenchSnapshot.from_dict(response.get("snapshot", {}))
```

同步修改：

- `ProjectApiClient.load_project()`、`create_project()`、`unload_project()` 返回 `ProjectSnapshot`
- `ProjectApiClient.get_project_preview()` 返回 `ProjectPreview`
- `WorkbenchPage.refresh_worker()` 与 `apply_snapshot()` 改为消费 `WorkbenchSnapshot`
- `WorkbenchPage.build_stats_payload()`、`apply_stats_snapshot()` 改成对象字段读取

- [ ] **Step 4: 运行 Project / Workbench 测试并确认通过**

Run: `uv run pytest tests/api/test_api_client.py -k "project_api_client or workbench_api_client or workbench_page or project_page" -v`
Expected: PASS。

- [ ] **Step 5: 格式化与检查 Project / Workbench 链路**

Run: `uv run ruff format api/Client/ProjectApiClient.py api/Client/WorkbenchApiClient.py frontend/ProjectPage.py frontend/Workbench/WorkbenchPage.py tests/api/test_api_client.py`
Run: `uv run ruff check --fix api/Client/ProjectApiClient.py api/Client/WorkbenchApiClient.py frontend/ProjectPage.py frontend/Workbench/WorkbenchPage.py tests/api/test_api_client.py`
Expected: 无报错。

- [ ] **Step 6: 提交 Project / Workbench 改造**

```bash
git add api/Client/ProjectApiClient.py api/Client/WorkbenchApiClient.py frontend/ProjectPage.py frontend/Workbench/WorkbenchPage.py tests/api/test_api_client.py
git commit -m "refactor: objectify project and workbench responses"
```

### Task 4: 迁移 Task 链路、`ApiStateStore` 与 SSE 增量合并

**Files:**
- Modify: `api/Client/TaskApiClient.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `api/Client/SseClient.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/Translation/TranslationPage.py`
- Modify: `frontend/Analysis/AnalysisPage.py`
- Modify: `frontend/Workbench/WorkbenchPage.py`
- Modify: `tests/api/test_api_client.py`
- Modify: `tests/api/test_api_state_store.py`

- [ ] **Step 1: 先写 Task 模型化与 Store 合并测试**

```python
from model.Api.TaskModels import TaskProgressUpdate
from model.Api.TaskModels import TaskSnapshot
from model.Api.TaskModels import TaskStatusUpdate


def test_api_state_store_hydrates_task_snapshot() -> None:
    store = ApiStateStore()
    store.hydrate_task(TaskSnapshot.from_dict({"task_type": "translation", "busy": True}))

    assert store.get_task_snapshot().task_type == "translation"
    assert store.is_busy() is True


def test_api_state_store_merges_task_progress_event_fields() -> None:
    store = ApiStateStore()
    store.hydrate_task(
        TaskSnapshot.from_dict(
            {"task_type": "translation", "status": "TRANSLATING", "busy": True, "line": 1}
        )
    )

    store.merge_task_progress(TaskProgressUpdate.from_dict({"line": 4}))

    assert store.get_task_snapshot().line == 4
    assert store.get_task_snapshot().status == "TRANSLATING"
```

补充页面测试断言：

- `TranslationPage`、`AnalysisPage` 从对象字段判断 `status`、`task_type`、`busy`
- `TaskApiClient.get_task_snapshot()` 返回 `TaskSnapshot`

- [ ] **Step 2: 运行 Task / Store 测试并确认失败**

Run: `uv run pytest tests/api/test_api_state_store.py tests/api/test_api_client.py -k "task or translation_page or analysis_page" -v`
Expected: FAIL，Store 与页面仍假定 `dict`。

- [ ] **Step 3: 实现 Task 客户端与 Store 对象化**

```python
def get_task_snapshot(self, request: dict[str, Any] | None = None) -> TaskSnapshot:
    response = self.api_client.post(TaskRoutes.SNAPSHOT_PATH, request or {})
    return TaskSnapshot.from_dict(response.get("task", {}))
```

```python
def apply_event(self, topic: str, payload: dict[str, Any]) -> None:
    if topic == EventTopic.TASK_STATUS_CHANGED.value:
        self.merge_task_status(TaskStatusUpdate.from_dict(payload))
    elif topic == EventTopic.TASK_PROGRESS_CHANGED.value:
        self.merge_task_progress(TaskProgressUpdate.from_dict(payload))
```

同步修改：

- `ApiStateStore.project_snapshot` 改为 `ProjectSnapshot`
- `ApiStateStore.task_snapshot` 改为 `TaskSnapshot`
- `get_project_snapshot()` / `get_task_snapshot()` 返回对象
- `reset_project()` 使用 `ProjectSnapshot.from_dict({})`
- `SseClient.dispatch_event()` 保持只解析 JSON，交由 `ApiStateStore` 解码 `Update`
- `AppFluentWindow` 首屏 hydration 改为直接传对象
- `TranslationPage`、`AnalysisPage`、`WorkbenchPage` 去除 `snapshot.get(...)`

- [ ] **Step 4: 运行 Task / Store 测试并确认通过**

Run: `uv run pytest tests/api/test_api_state_store.py tests/api/test_api_client.py -k "task or translation_page or analysis_page or workbench_page" -v`
Expected: PASS。

- [ ] **Step 5: 格式化与检查 Task / Store 链路**

Run: `uv run ruff format api/Client/TaskApiClient.py api/Client/ApiStateStore.py api/Client/SseClient.py frontend/AppFluentWindow.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py tests/api/test_api_state_store.py tests/api/test_api_client.py`
Run: `uv run ruff check --fix api/Client/TaskApiClient.py api/Client/ApiStateStore.py api/Client/SseClient.py frontend/AppFluentWindow.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py tests/api/test_api_state_store.py tests/api/test_api_client.py`
Expected: 无报错。

- [ ] **Step 6: 提交 Task / Store / SSE 改造**

```bash
git add api/Client/TaskApiClient.py api/Client/ApiStateStore.py api/Client/SseClient.py frontend/AppFluentWindow.py frontend/Translation/TranslationPage.py frontend/Analysis/AnalysisPage.py frontend/Workbench/WorkbenchPage.py tests/api/test_api_state_store.py tests/api/test_api_client.py
git commit -m "refactor: store api snapshots as models"
```

### Task 5: 全链路回归、边界扫描与收尾

**Files:**
- Modify: 如实现过程中新增注释或收尾修正涉及的文件
- Test: `tests/api/test_api_client.py`
- Test: `tests/api/test_api_state_store.py`
- Test: `tests/model/api/test_settings_models.py`
- Test: `tests/model/api/test_project_models.py`
- Test: `tests/model/api/test_workbench_models.py`
- Test: `tests/model/api/test_task_models.py`

- [ ] **Step 1: 扫描页面和客户端残留的 `dict` 读取点**

Run: `rg -n "response\\.get\\(|snapshot\\.get\\(|get_task_snapshot\\(\\)\\.get\\(|get_project_snapshot\\(\\)\\.get\\(" api frontend -S`
Expected: 只剩 HTTP 边界或 `from_dict()` 内部允许存在的字典读取。

- [ ] **Step 2: 跑 DTO、客户端、Store 全量测试**

Run: `uv run pytest tests/model/api tests/api/test_api_client.py tests/api/test_api_state_store.py -v`
Expected: PASS。

- [ ] **Step 3: 跑 API 相关回归测试**

Run: `uv run pytest tests/api -v`
Expected: PASS。

- [ ] **Step 4: 记录最小手动验证路径**

手动验证：

1. 启动应用：`uv run app.py`
2. 打开设置页，确认基础设置与专家设置正常显示与保存。
3. 打开工程页，确认最近项目、新建/打开工程链路正常。
4. 打开工作台，确认快照刷新与文件操作按钮状态正常。
5. 启动翻译或分析，确认状态按钮、进度、忙碌态同步正常。

- [ ] **Step 5: 提交收尾改动**

```bash
git add .
git commit -m "test: verify api response model migration"
```

## 风险与注意事项

- `TaskSnapshot` 目前可能包含服务端新增字段，例如分析任务特有统计项；实现时先对照 `api/Application/TaskAppService.py`，避免测试只覆盖通用字段而遗漏分析特有字段。
- `ProjectPage` 既依赖项目快照，也依赖设置快照中的最近项目列表，迁移时不要把这两条链路耦合回一个字典。
- `WorkbenchPage` 目前本地还维护 `file_entries: list[dict[str, Any]]` 作为表格视图数据；这是 UI 内部展示结构，可以保留，但输入必须来自 `WorkbenchSnapshot`。
- `TranslationPage` 与 `AnalysisPage` 的按钮状态逻辑大量依赖 `task_type` 和 `status`，迁移时优先确保语义不变，再考虑简化。
- `ApiStateStore` 的默认对象必须覆盖未加载工程与空闲任务两种安全初始态，避免窗口初始化时访问空引用。

## 完成定义

满足以下条件时，本计划视为完成：

- `model/Api/` 下新增的 `Snapshot` / `Update` 模型具备测试覆盖。
- 各业务 `ApiClient` 对外返回对象，而不是 `dict`。
- `ApiStateStore` 内部只缓存对象。
- 主要页面不再直接依赖 API 响应字典。
- `tests/model/api`、`tests/api` 相关测试通过。
- 通过 `rg` 扫描确认 `response.get(...)` / `snapshot.get(...)` 未继续扩散到 UI 层。
