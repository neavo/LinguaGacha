# API 测试重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tests/api` 重组为与 `api/` 镜像对应的目录结构，清理白盒与页面元素依赖用例，并在必要时对业务代码做最小可测试性整理。

**Architecture:** 这轮只重构 `tests/api` 与少量被迫配套的业务边界，不改 API 协议语义。先用目录镜像和测试骨架固定新的归属关系，再把 `test_api_client.py` 与 `test_api_layering_boundary.py` 拆回真实被测对象，删除页面元素依赖测试，并把仍有价值的纯逻辑断言迁回 `api/Bridge`、`api/Application`、`api/Server`、`api/Contract` 对应测试文件，最后用 `pytest`、`ruff` 和反模式扫描完成验证闭环。

**Tech Stack:** Python 3.14, pytest, PySide6, Ruff, ripgrep, ast-grep, uv

---

## 文件结构

### 新建文件

- `tests/api/application/conftest.py`
- `tests/api/client/conftest.py`
- `tests/api/client/test_project_api_client.py`
- `tests/api/client/test_quality_rule_api_client.py`
- `tests/api/client/test_proofreading_api_client.py`
- `tests/api/client/test_task_api_client.py`
- `tests/api/client/test_settings_api_client.py`
- `tests/api/client/test_workbench_api_client.py`
- `tests/api/client/test_app_client_context.py`
- `tests/api/server/test_route_contracts.py`
- `tests/api/bridge/test_event_topic.py`
- `tests/api/test_api_spec_contract.py`

### 修改文件

- `tests/api/conftest.py`
- `tests/api/test_project_app_service.py`
- `tests/api/test_task_app_service.py`
- `tests/api/test_workbench_app_service.py`
- `tests/api/test_settings_app_service.py`
- `tests/api/test_proofreading_app_service.py`
- `tests/api/test_event_bridge.py`
- `tests/api/test_event_stream_service.py`
- `tests/api/test_api_state_store.py`
- `tests/api/test_core_api_server.py`
- `tests/api/test_proofreading_payloads.py`
- `api/Bridge/EventBridge.py`
- `api/Bridge/ProofreadingRuleImpact.py`

### 删除文件

- `tests/api/test_api_client.py`
- `tests/api/test_api_layering_boundary.py`
- `tests/api/test_proofreading_page_api_consumer.py`
- `tests/api/test_quality_frontend_prompt_guards.py`

### 视情况删除或清空后移除的文件

- `tests/api/test_proofreading_rule_impact.py`
- `tests/api/test_frontend_core_boundary.py`
- `tests/api/boundary_contracts.py`

### 参考文件

- `docs/superpowers/specs/2026-03-26-api-tests-restructure-design.md`
- `api/Client/ApiClient.py`
- `api/Client/AppClientContext.py`
- `api/Bridge/EventTopic.py`
- `api/Server/Routes/QualityRoutes.py`
- `api/Server/Routes/ProofreadingRoutes.py`

## 任务拆分

### Task 1: 建立镜像目录和最近作用域夹具

**Files:**
- Create: `tests/api/application/conftest.py`
- Create: `tests/api/client/conftest.py`
- Modify: `tests/api/conftest.py`

- [ ] **Step 1: 先写失败测试，固定 `tests/api` 子目录存在并能从最近作用域取夹具**

```python
from pathlib import Path


def test_api_test_directories_follow_runtime_layout() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    tests_api_dir = root_dir / "tests" / "api"

    assert (tests_api_dir / "application").is_dir()
    assert (tests_api_dir / "client").is_dir()


def test_api_root_conftest_only_keeps_shared_fixtures() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "tests" / "api" / "conftest.py").read_text(
        encoding="utf-8"
    )

    assert "def fake_project_manager" not in content
    assert "def fake_settings_config" not in content
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_spec_contract.py::test_api_test_directories_follow_runtime_layout tests/api/test_api_spec_contract.py::test_api_root_conftest_only_keeps_shared_fixtures -v`

Expected: FAIL，提示 `tests/api/application`、`tests/api/client` 不存在，或根 `conftest.py` 仍保留领域夹具。

- [ ] **Step 3: 建目录并下沉夹具**

```python
# tests/api/application/conftest.py
import pytest

from api.Application.ProjectAppService import ProjectAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from base.Base import Base

from tests.api.support.application_fakes import (
    FakeEngine,
    FakeProjectManager,
    FakeSettingsConfig,
    FakeTaskDataManager,
    FakeWorkbenchManager,
)


@pytest.fixture
def fake_project_manager() -> FakeProjectManager:
    return FakeProjectManager()
```

```python
# tests/api/client/conftest.py
import pytest

from api.Application.ProjectAppService import ProjectAppService
from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Application.SettingsAppService import SettingsAppService
from api.Application.TaskAppService import TaskAppService
from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Server.ServerBootstrap import ServerBootstrap


@pytest.fixture
def start_api_server():
    runtimes: list[callable] = []

    def factory(**services):
        base_url, shutdown = ServerBootstrap.start_for_test(**services)
        runtimes.append(shutdown)
        return base_url

    yield factory

    for shutdown in reversed(runtimes):
        shutdown()
```

要求：

- 把 `FakeProjectManager`、`FakeTaskDataManager`、`FakeWorkbenchManager`、`FakeSettingsConfig` 及其关联夹具迁到最近目录或同级支持模块。
- 根 `tests/api/conftest.py` 只保留跨 `application` 与 `client` 都会用到的最小共享夹具，例如 `lg_path`。
- 如果为了减少重复需要增加 `tests/api/support/application_fakes.py`，本任务一并创建并补注释说明“为什么这些桩属于测试支持层”。

- [ ] **Step 4: 运行目录与夹具相关测试确认通过**

Run: `uv run pytest tests/api/test_api_spec_contract.py::test_api_test_directories_follow_runtime_layout tests/api/test_api_spec_contract.py::test_api_root_conftest_only_keeps_shared_fixtures tests/api/test_project_app_service.py tests/api/test_settings_app_service.py -v`

Expected: PASS，确认新目录存在、夹具下沉后应用层测试仍能正常收集与运行。

- [ ] **Step 5: 提交**

```bash
git add tests/api/conftest.py tests/api/application/conftest.py tests/api/client/conftest.py tests/api/support/application_fakes.py tests/api/test_api_spec_contract.py
git commit -m "test: scope api fixtures by mirrored test directories"
```

### Task 2: 拆分 `test_api_client.py` 并删除混入的页面测试

**Files:**
- Create: `tests/api/client/test_project_api_client.py`
- Create: `tests/api/client/test_quality_rule_api_client.py`
- Create: `tests/api/client/test_proofreading_api_client.py`
- Create: `tests/api/client/test_task_api_client.py`
- Create: `tests/api/client/test_settings_api_client.py`
- Create: `tests/api/client/test_workbench_api_client.py`
- Delete: `tests/api/test_api_client.py`

- [ ] **Step 1: 先写失败测试，固定客户端测试文件一一对应且不再夹带页面行为**

```python
from pathlib import Path


def test_client_tests_follow_one_file_per_api_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    client_dir = root_dir / "tests" / "api" / "client"

    assert (client_dir / "test_project_api_client.py").is_file()
    assert (client_dir / "test_quality_rule_api_client.py").is_file()
    assert (client_dir / "test_proofreading_api_client.py").is_file()
    assert (client_dir / "test_task_api_client.py").is_file()
    assert (client_dir / "test_settings_api_client.py").is_file()
    assert (client_dir / "test_workbench_api_client.py").is_file()


def test_client_test_files_do_not_reference_frontend_pages() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    client_dir = root_dir / "tests" / "api" / "client"

    for file_path in client_dir.glob("test_*_api_client.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "frontend." not in content
        assert "ProjectPage" not in content
        assert "TranslationPage" not in content
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_spec_contract.py::test_client_tests_follow_one_file_per_api_client tests/api/test_api_spec_contract.py::test_client_test_files_do_not_reference_frontend_pages -v`

Expected: FAIL，提示新客户端测试文件尚未创建，或旧实现仍然把页面测试夹在客户端文件里。

- [ ] **Step 3: 把旧客户端用例按被测对象拆分**

```python
# tests/api/client/test_project_api_client.py
from api.Application.ProjectAppService import ProjectAppService
from api.Client.ApiClient import ApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from model.Api.ProjectModels import ProjectPreview
from model.Api.ProjectModels import ProjectSnapshot


def test_load_project_returns_project_snapshot(
    fake_project_manager,
    lg_path: str,
    start_api_server,
) -> None:
    base_url = start_api_server(
        project_app_service=ProjectAppService(fake_project_manager)
    )
    api_client = ApiClient(base_url)
    project_client = ProjectApiClient(api_client)

    result = project_client.load_project({"path": lg_path})

    assert isinstance(result, ProjectSnapshot)
    assert result.path == lg_path
    assert result.loaded is True
```

```python
# tests/api/client/test_quality_rule_api_client.py
from unittest.mock import Mock

from api.Application.QualityRuleAppService import QualityRuleAppService
from api.Client.ApiClient import ApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot


def test_get_rule_snapshot_returns_quality_rule_snapshot(start_api_server) -> None:
    quality_rule_facade = Mock()
    quality_rule_facade.get_rule_snapshot.return_value = {
        "rule_type": "glossary",
        "revision": 2,
        "meta": {"enabled": True},
        "statistics": {"available": False, "results": {}},
        "entries": [{"entry_id": "glossary:0", "src": "勇者", "dst": "Hero"}],
    }
    base_url = start_api_server(
        quality_rule_app_service=QualityRuleAppService(quality_rule_facade)
    )

    snapshot = QualityRuleApiClient(ApiClient(base_url)).get_rule_snapshot("glossary")

    assert isinstance(snapshot, QualityRuleSnapshot)
    assert snapshot.entries[0].src == "勇者"
```

要求：

- 只迁移真正对应 `api/Client/*ApiClient.py` 的用例。
- `test_project_page_uses_project_api_client`、`test_translation_page_uses_task_api_client`、`test_analysis_page_uses_task_api_client`、`test_workbench_page_uses_workbench_api_client`、设置页相关页面测试全部不要迁移，直接删除。
- 每个新文件保持 AAA 结构，不把多个客户端揉回一个新文件。

- [ ] **Step 4: 运行客户端测试确认通过**

Run: `uv run pytest tests/api/client -v`

Expected: PASS，客户端测试全部在镜像目录下通过，且不再依赖 `frontend` 页面对象。

Run: `rg -n "ProjectPage|TranslationPage|AnalysisPage|WorkbenchPage|AppSettingsPage|BasicSettingsPage|ExpertSettingsPage" tests/api/client -S`

Expected: 无结果。

- [ ] **Step 5: 提交**

```bash
git add tests/api/client tests/api/test_api_spec_contract.py
git rm tests/api/test_api_client.py
git commit -m "test: split api client coverage by mirrored files"
```

### Task 3: 拆分边界与契约测试并去掉 `__new__`、`call_args_list`

**Files:**
- Create: `tests/api/client/test_app_client_context.py`
- Create: `tests/api/server/test_route_contracts.py`
- Create: `tests/api/bridge/test_event_topic.py`
- Create: `tests/api/test_api_spec_contract.py`
- Delete: `tests/api/test_api_layering_boundary.py`
- Modify: `tests/api/test_core_api_server.py`
- Modify: `tests/api/test_event_bridge.py`

- [ ] **Step 1: 先写失败测试，固定新的边界测试归属**

```python
from pathlib import Path


def test_boundary_checks_are_split_by_runtime_owner() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    tests_api_dir = root_dir / "tests" / "api"

    assert (tests_api_dir / "client" / "test_app_client_context.py").is_file()
    assert (tests_api_dir / "server" / "test_route_contracts.py").is_file()
    assert (tests_api_dir / "bridge" / "test_event_topic.py").is_file()


def test_legacy_layering_boundary_file_is_removed() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    assert not (root_dir / "tests" / "api" / "test_api_layering_boundary.py").exists()
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_spec_contract.py::test_boundary_checks_are_split_by_runtime_owner tests/api/test_api_spec_contract.py::test_legacy_layering_boundary_file_is_removed -v`

Expected: FAIL，提示新的边界测试文件尚未创建，旧混合文件仍存在。

- [ ] **Step 3: 用真实构造与轻量探针替换白盒断言**

```python
# tests/api/client/test_app_client_context.py
from unittest.mock import Mock

from api.Client.ApiClient import ApiClient
from api.Client.ApiStateStore import ApiStateStore
from api.Client.AppClientContext import AppClientContext
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient


def test_app_client_context_groups_real_clients() -> None:
    api_client = Mock(spec=ApiClient)
    context = AppClientContext(
        project_api_client=ProjectApiClient(api_client),
        task_api_client=TaskApiClient(api_client),
        workbench_api_client=WorkbenchApiClient(api_client),
        settings_api_client=SettingsApiClient(api_client),
        quality_rule_api_client=QualityRuleApiClient(api_client),
        proofreading_api_client=ProofreadingApiClient(api_client),
        api_state_store=ApiStateStore(),
    )

    assert isinstance(context.project_api_client, ProjectApiClient)
    assert isinstance(context.proofreading_api_client, ProofreadingApiClient)
```

```python
# tests/api/server/test_route_contracts.py
class RouteRecorder:
    """记录对外注册的 HTTP 方法与路径，避免盯 Mock.call_args_list。"""

    def __init__(self) -> None:
        self.routes: list[tuple[str, str]] = []

    def add_json_route(self, method: str, path: str, handler) -> None:
        del handler
        self.routes.append((method, path))
```

要求：

- `AppClientContext` 测试必须用真实客户端构造，不再使用 `ProjectApiClient.__new__` 这类绕过构造的写法。
- 路由注册测试改用自定义 `RouteRecorder` 或等价探针对象，断言最终注册出的 `(method, path)` 列表，不再以 `call_args_list` 作为主要断言。
- 客户端契约相关用例若只是在验证模型解析与路由路径，应移动到对应 `client` 或 `server` 测试文件，不要继续堆在单个边界文件里。

- [ ] **Step 4: 运行边界与契约测试确认通过**

Run: `uv run pytest tests/api/client/test_app_client_context.py tests/api/server/test_route_contracts.py tests/api/bridge/test_event_topic.py tests/api/test_api_spec_contract.py tests/api/test_core_api_server.py tests/api/test_event_bridge.py -v`

Expected: PASS，确认边界测试已按所有者拆开，旧的 `__new__` 与 `call_args_list` 反模式不再作为主要断言存在。

Run: `rg -n "__new__|call_args|call_args_list" tests/api/client tests/api/server tests/api/bridge tests/api/test_api_spec_contract.py -S`

Expected: 无结果。

- [ ] **Step 5: 提交**

```bash
git add tests/api/client/test_app_client_context.py tests/api/server/test_route_contracts.py tests/api/bridge/test_event_topic.py tests/api/test_api_spec_contract.py tests/api/test_core_api_server.py tests/api/test_event_bridge.py
git rm tests/api/test_api_layering_boundary.py
git commit -m "test: split api boundary coverage by runtime owners"
```

### Task 4: 删除页面元素依赖测试，并把纯逻辑迁回 Bridge

**Files:**
- Modify: `tests/api/test_event_bridge.py`
- Modify: `tests/api/test_proofreading_rule_impact.py`
- Modify: `api/Bridge/EventBridge.py`
- Modify: `api/Bridge/ProofreadingRuleImpact.py`
- Delete: `tests/api/test_proofreading_page_api_consumer.py`
- Delete: `tests/api/test_quality_frontend_prompt_guards.py`
- Delete or Move: `tests/api/test_proofreading_rule_impact.py`

- [ ] **Step 1: 先写失败测试，固定桥接层与规则影响逻辑共享同一来源**

```python
from base.Base import Base
from api.Bridge.EventBridge import EventBridge
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact


def test_quality_rule_update_uses_proofreading_rule_impact_single_source(
    monkeypatch,
) -> None:
    observed: list[dict[str, object] | None] = []

    def fake_extract(data: dict[str, object] | None) -> tuple[list[str], list[str]]:
        observed.append(data)
        return ["glossary"], []

    monkeypatch.setattr(
        ProofreadingRuleImpact,
        "extract_relevant_rule_update",
        fake_extract,
    )

    topic, payload = EventBridge().map_event(
        Base.Event.QUALITY_RULE_UPDATE,
        {"rule_types": ["glossary"]},
    )

    assert observed == [{"rule_types": ["glossary"]}]
    assert topic == "proofreading.snapshot_invalidated"
    assert payload["rule_types"] == ["glossary"]
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_event_bridge.py::test_quality_rule_update_uses_proofreading_rule_impact_single_source -v`

Expected: FAIL，如果旧测试仍依赖 `frontend.Proofreading.ProofreadingPage` 或相关页面对象。

- [ ] **Step 3: 删除页面相关测试并把纯逻辑收口到 Bridge**

```python
# tests/api/test_proofreading_rule_impact.py
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact


def test_extract_relevant_rule_update_filters_rule_types_and_meta_keys() -> None:
    relevant_rule_types, relevant_meta_keys = (
        ProofreadingRuleImpact.extract_relevant_rule_update(
            {
                "rule_types": ["glossary", "translation_prompt"],
                "meta_keys": ["glossary_enable", "analysis_prompt_enable"],
            }
        )
    )

    assert relevant_rule_types == ["glossary"]
    assert relevant_meta_keys == ["glossary_enable"]
```

要求：

- `tests/api/test_proofreading_page_api_consumer.py` 全部删除，不迁移。
- `tests/api/test_quality_frontend_prompt_guards.py` 全部删除，不迁移。
- `tests/api/test_proofreading_rule_impact.py` 如果保留，只允许覆盖 `ProofreadingRuleImpact` 本身，不允许再 import `frontend.Proofreading.ProofreadingPage`。
- 如果 `EventBridge` 中还缺少便于直接验证的公开小入口，可以新增最小帮助方法，但不得增加测试后门。

- [ ] **Step 4: 运行 Bridge 相关测试确认通过**

Run: `uv run pytest tests/api/test_event_bridge.py tests/api/test_proofreading_rule_impact.py tests/api/test_event_stream_service.py -v`

Expected: PASS，确认校对规则影响逻辑只在 `api/Bridge` 侧验证，不再依赖页面对象。

Run: `rg -n "frontend\\.|ProofreadingPage|CustomPromptPage|SettingCard" tests/api -S`

Expected: 只剩非 `tests/api` 目录外的结果；`tests/api` 内无页面对象引用。

- [ ] **Step 5: 提交**

```bash
git add api/Bridge/EventBridge.py api/Bridge/ProofreadingRuleImpact.py tests/api/test_event_bridge.py tests/api/test_proofreading_rule_impact.py tests/api/test_event_stream_service.py
git rm tests/api/test_proofreading_page_api_consumer.py tests/api/test_quality_frontend_prompt_guards.py
git commit -m "test: remove page-coupled api tests"
```

### Task 5: 清理残余契约文件、格式化并完成总验证

**Files:**
- Modify: `tests/api/boundary_contracts.py`
- Modify: `tests/api/test_frontend_core_boundary.py`
- Modify: `tests/api/test_api_state_store.py`
- Modify: `tests/api/test_proofreading_payloads.py`
- Modify: `docs/superpowers/plans/2026-03-26-api-tests-restructure.md`

实际落地差异：
- `tests/api/boundary_contracts.py` 已删除，服务端路由契约下沉到 `tests/api/server/route_contracts.py`
- `tests/api/test_frontend_core_boundary.py` 已迁移到 `tests/frontend/test_frontend_core_boundary.py`，避免继续污染 `tests/api` 语义

- [x] **Step 1: 先写失败测试，固定残余反模式和旧文件已清理**

```python
from pathlib import Path


def test_removed_page_coupled_files_no_longer_exist() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    tests_api_dir = root_dir / "tests" / "api"

    assert not (tests_api_dir / "test_proofreading_page_api_consumer.py").exists()
    assert not (tests_api_dir / "test_quality_frontend_prompt_guards.py").exists()


def test_api_tests_do_not_use_known_white_box_antipatterns() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for file_path in (root_dir / "tests" / "api").rglob("test_*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert ".__new__(" not in content
        assert "call_args_list" not in content
```

- [x] **Step 2: 运行测试并确认失败**

Run: `uv run pytest tests/api/test_api_spec_contract.py::test_removed_page_coupled_files_no_longer_exist tests/api/test_api_spec_contract.py::test_api_tests_do_not_use_known_white_box_antipatterns -v`

Expected: FAIL，直到旧文件与白盒反模式全部清理完成。

- [x] **Step 3: 收尾清理与静态搜索**

```python
# tests/api/test_api_spec_contract.py
def test_api_tests_do_not_reference_frontend_runtime() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for file_path in (root_dir / "tests" / "api").rglob("test_*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "frontend." not in content
```

要求：

- `tests/api/test_frontend_core_boundary.py` 如果只剩前端导入守卫，迁出或删除，避免继续污染 `tests/api` 语义。
- `tests/api/boundary_contracts.py` 若只为单个测试文件服务，合并回该文件后删除；若仍服务多个 `server` 测试，迁到 `tests/api/server/` 最近作用域。
- 完成后统一运行 `ruff format` 和 `ruff check --fix` 处理所有改动文件。

- [x] **Step 4: 运行完整验证**

Run: `uv run pytest tests/api -v`

Expected: PASS。

Run: `uv run ruff format tests/api api/Bridge`

Expected: PASS。

Run: `uv run ruff check --fix tests/api api/Bridge`

Expected: PASS。

Run: `rg -n "__new__|call_args|call_args_list|tmp_path|mock_open" tests/api -S`

Expected: 只允许保留 `tmp_path` 在根共享夹具 `lg_path` 的合理使用；其余结果为空。

Run: `ast-grep run --pattern "from frontend.\$X import \$Y" tests/api`

Expected: 无结果。

- [ ] **Step 5: 提交**

说明：按当前任务要求，本次已完成实现与验证，但仍未执行提交，等待规格复核与代码质量复核后统一提交。

```bash
git add tests/api api/Bridge docs/superpowers/plans/2026-03-26-api-tests-restructure.md
git commit -m "test: finish api test structure cleanup"
```

## 自检结果

### 1. 规格覆盖

- 目录镜像：由 Task 1、Task 2、Task 3 覆盖。
- 单个业务文件一个主测试文件：由 Task 2、Task 3 覆盖。
- 删除页面元素依赖测试：由 Task 2、Task 4、Task 5 覆盖。
- 白盒整改：由 Task 3、Task 5 覆盖。
- 必要时允许最小业务侧调整：由 Task 4 覆盖。
- 验证闭环：由 Task 5 覆盖。

### 2. 占位词扫描

- 本计划未使用 `TODO`、`TBD`、`之后再补`、`类似 Task N` 之类占位写法。
- 每个任务都给出了明确文件、命令、预期结果和至少一个具体代码片段。

### 3. 名称一致性

- 镜像目录统一使用 `tests/api/application`、`tests/api/client`、`tests/api/server`、`tests/api/bridge`。
- 客户端文件统一使用 `test_<name>_api_client.py`。
- 反模式扫描统一使用 `__new__|call_args|call_args_list|tmp_path|mock_open`。
