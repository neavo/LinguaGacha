# API Client Context 分层清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 UI 客户端依赖容器从 `api/Application/AppContext.py` 迁回 `api/Client/AppClientContext.py`，清除 `api/Application -> api/Client` 的层次倒挂，同时保持 UI 启动行为不变。

**Architecture:** 这轮只修“归属与命名”，不改 HTTP/SSE 协议与客户端行为。先用边界测试固定新的依赖方向与导入路径，再迁移 `AppContext` 到 `api/Client` 并更新 `app.py`、`AppFluentWindow.py` 与文档引用，最后通过静态搜索、边界测试、API 测试和 CLI 启动测试确认没有行为回归。

**Tech Stack:** Python 3.14, PySide6, pytest, Ruff, ripgrep

---

## 文件结构

### 新建文件

- `api/Client/AppClientContext.py`
- `tests/api/test_api_layering_boundary.py`

### 修改文件

- `api/Client/__init__.py`
- `app.py`
- `frontend/AppFluentWindow.py`
- `docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md`
- `docs/superpowers/plans/2026-03-24-frontend-core-separation.md`

### 删除文件

- `api/Application/AppContext.py`

### 参考文件

- `docs/superpowers/specs/2026-03-24-api-client-context-layering-design.md`
- `tests/api/test_frontend_core_boundary.py`
- `tests/api/test_api_client.py`
- `tests/api/test_core_api_server.py`
- `tests/base/test_cli_manager.py`

## 任务拆分

### Task 1: 固定新的上下文归属与层次边界

**Files:**
- Create: `api/Client/AppClientContext.py`
- Create: `tests/api/test_api_layering_boundary.py`
- Modify: `api/Client/__init__.py`

- [ ] **Step 1: 先写失败测试，固定新上下文路径与 Application 分层约束**

```python
from pathlib import Path

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Client.AppClientContext import AppClientContext


def test_app_client_context_groups_ui_clients() -> None:
    context = AppClientContext(
        project_api_client=ProjectApiClient.__new__(ProjectApiClient),
        task_api_client=TaskApiClient.__new__(TaskApiClient),
        workbench_api_client=WorkbenchApiClient.__new__(WorkbenchApiClient),
        settings_api_client=SettingsApiClient.__new__(SettingsApiClient),
        api_state_store=ApiStateStore(),
    )

    assert isinstance(context.api_state_store, ApiStateStore)


def test_api_application_layer_does_not_import_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_dir = root_dir / "api" / "Application"

    for file_path in application_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "from api.Client" not in content
        assert "import api.Client" not in content
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_layering_boundary.py -v`
Expected: FAIL，提示 `api.Client.AppClientContext` 不存在，或 `api/Application/AppContext.py` 仍然引用 `api.Client`。

- [ ] **Step 3: 实现最小上下文类型并导出**

```python
from dataclasses import dataclass

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient


@dataclass(frozen=True)
class AppClientContext:
    """UI 侧 API 依赖容器，统一收口客户端边界对象。"""

    project_api_client: ProjectApiClient
    task_api_client: TaskApiClient
    workbench_api_client: WorkbenchApiClient
    settings_api_client: SettingsApiClient
    api_state_store: ApiStateStore
```

要求：

- 注释继续说明“为什么它属于 UI 客户端边界”
- `api/Client/__init__.py` 需要导出 `AppClientContext`
- 暂时不要删除旧文件，先让新类型可用

- [ ] **Step 4: 再跑边界测试确认通过**

Run: `uv run pytest tests/api/test_api_layering_boundary.py -v`
Expected: PASS，确认新上下文类型存在且当前 `api/Application` 不再出现 `api.Client` 依赖。

- [ ] **Step 5: 提交**

```bash
git add api/Client/AppClientContext.py api/Client/__init__.py tests/api/test_api_layering_boundary.py
git commit -m "test: add api client context boundary checks"
```

### Task 2: 迁移 UI 启动装配到 `AppClientContext`

**Files:**
- Modify: `app.py`
- Modify: `frontend/AppFluentWindow.py`
- Delete: `api/Application/AppContext.py`
- Modify: `tests/api/test_api_layering_boundary.py`

- [ ] **Step 1: 先补失败测试，固定 UI 装配链必须使用新路径**

```python
from pathlib import Path


def test_ui_bootstrap_imports_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    app_content = (root_dir / "app.py").read_text(encoding="utf-8")
    window_content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(
        encoding="utf-8"
    )

    assert "from api.Client.AppClientContext import AppClientContext" in app_content
    assert "from api.Client.AppClientContext import AppClientContext" in window_content
    assert "from api.Application.AppContext import AppContext" not in app_content
    assert "from api.Application.AppContext import AppContext" not in window_content
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_layering_boundary.py::test_ui_bootstrap_imports_app_client_context -v`
Expected: FAIL，提示 `app.py` 或 `frontend/AppFluentWindow.py` 仍然引用旧路径。

- [ ] **Step 3: 更新启动装配与窗口类型**

```python
from api.Client.AppClientContext import AppClientContext


app_client_context: AppClientContext | None = None
if local_api_server_runtime is not None:
    api_client = ApiClient(local_api_server_runtime.base_url)
    app_client_context = AppClientContext(
        project_api_client=ProjectApiClient(api_client),
        task_api_client=TaskApiClient(api_client),
        workbench_api_client=WorkbenchApiClient(api_client),
        settings_api_client=SettingsApiClient(api_client),
        api_state_store=ApiStateStore(),
    )
```

同时修改 [`frontend/AppFluentWindow.py`](E:/Project/LinguaGacha/frontend/AppFluentWindow.py)：

- 构造函数入参类型改为 `AppClientContext | None`
- 报错文案改为 `UI 模式必须提供 AppClientContext`
- 统一成员赋值继续从 `app_client_context` 取值

最后删除旧文件 `api/Application/AppContext.py`，避免旧路径继续被误用。

- [ ] **Step 4: 运行边界与启动相关测试确认通过**

Run: `uv run pytest tests/api/test_api_layering_boundary.py tests/base/test_cli_manager.py -v`
Expected: PASS，确认 UI 装配链已切到新路径，CLI 相关行为无回归。

- [ ] **Step 5: 提交**

```bash
git add app.py frontend/AppFluentWindow.py tests/api/test_api_layering_boundary.py
git rm api/Application/AppContext.py
git commit -m "refactor: move app client context to client layer"
```

### Task 3: 同步文档引用并完成验证闭环

**Files:**
- Modify: `docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md`
- Modify: `docs/superpowers/plans/2026-03-24-frontend-core-separation.md`
- Modify: `tests/api/test_frontend_core_boundary.py`

- [ ] **Step 1: 先补失败测试，固定第一阶段边界与文档引用**

```python
from pathlib import Path


def test_frontend_core_design_doc_uses_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (
        root_dir
        / "docs"
        / "superpowers"
        / "specs"
        / "2026-03-24-frontend-core-separation-design.md"
    ).read_text(encoding="utf-8")

    assert "AppClientContext.py" in spec_content
    assert "AppContext.py" not in spec_content
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_layering_boundary.py::test_frontend_core_design_doc_uses_app_client_context -v`
Expected: FAIL，提示旧设计文档仍保留 `AppContext.py`。

- [ ] **Step 3: 更新文档与边界测试**

要求：

- 将旧设计/旧实现计划中已经过时的 `AppContext.py` 路径更新为 `AppClientContext.py`
- 保持文档其他历史结论不变，只修正当前正式边界命名
- 检查 `tests/api/test_frontend_core_boundary.py` 是否需要补充“`frontend` 只通过 `api.Client` 获取客户端上下文”的断言；若已有覆盖则保持最小改动

- [ ] **Step 4: 运行完整验证**

Run: `uv run pytest tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py tests/api/test_api_client.py tests/api/test_core_api_server.py tests/base/test_cli_manager.py -v`
Expected: PASS，确认边界、客户端、服务端骨架与 CLI 路径均未回归。

Run: `rg -n "from api\\.Application\\.AppContext import AppContext|class AppContext" . -S`
Expected: 无结果。

Run: `rg -n "^from api\\.Client|^import api\\.Client" api/Application -S`
Expected: 无结果。

Run: `uv run ruff format api/Client/AppClientContext.py app.py frontend/AppFluentWindow.py tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py`
Expected: PASS。

Run: `uv run ruff check --fix api/Client/AppClientContext.py app.py frontend/AppFluentWindow.py tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-03-24-frontend-core-separation-design.md docs/superpowers/plans/2026-03-24-frontend-core-separation.md tests/api/test_frontend_core_boundary.py tests/api/test_api_layering_boundary.py
git commit -m "docs: align app client context layering references"
```
