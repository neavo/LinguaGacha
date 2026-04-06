# Model 子树 UI/Core 分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `frontend/Model/*` 全面切换到本地 Core API 边界，不再直接依赖 `Config`、`Engine`、`ModelManager`，同时保持现有模型管理交互行为不变。

**Architecture:** 先为模型管理补齐 `ModelModels`、`ModelPayloads`、`ModelApiClient`、`ModelAppService` 与 `ModelRoutes`，再把 `ServerBootstrap`、`AppClientContext`、`app.py` 和 `AppFluentWindow` 接到新客户端，最后按“模型列表页动作 -> 设置弹窗 patch -> 模型选择页保存 -> 边界测试”顺序迁移前端。任务状态读取复用现有 `ApiStateStore` / `TaskApiClient`，不把在线模型目录拉取迁进 Core。

**Tech Stack:** Python 3.14、PySide6、qfluentwidgets、本地 HTTP API、pytest、ruff、uv

---

## File Structure

### New Files

- `model/Api/ModelModels.py`
  模型快照冻结对象，统一描述 `ModelPageSnapshot`、`ModelEntrySnapshot` 及嵌套 request/threshold/thinking/generation 结构。
- `api/Contract/ModelPayloads.py`
  服务端 `data` 载荷对象，负责把 Core 结果稳定映射到 HTTP 响应。
- `api/Client/ModelApiClient.py`
  UI 侧模型客户端，提供 `get_snapshot()`、`update_model()`、`activate_model()`、`add_model()`、`delete_model()`、`reset_preset_model()`、`reorder_model()`。
- `api/Application/ModelAppService.py`
  模型应用服务，负责读取 `Config`、驱动 `ModelManager`、校验 patch 白名单并返回 payload。
- `api/Server/Routes/ModelRoutes.py`
  模型 HTTP 路由注册入口。
- `tests/api/application/test_model_app_service.py`
  应用服务单测，覆盖快照组装、动作约束与 patch 白名单。
- `tests/api/client/test_model_api_client.py`
  客户端集成测试，覆盖响应对象反序列化与路由连通。

### Modified Files

- `model/Api/__init__.py`
  导出新的模型 API 冻结对象。
- `api/Client/AppClientContext.py`
  把 `ModelApiClient` 加入 UI 允许消费的客户端容器。
- `api/Server/ServerBootstrap.py`
  注册 `ModelAppService` 与 `ModelRoutes`。
- `app.py`
  在 UI 模式下构造 `ModelApiClient` 并注入 `AppClientContext`。
- `frontend/AppFluentWindow.py`
  将 `model_api_client` 传递给 `ModelPage` 及相关弹窗。
- `frontend/Model/ModelPage.py`
  切换到 `ModelApiClient` 的快照读取与动作接口。
- `frontend/Model/ModelBasicSettingPage.py`
  切换到 `update_model()`；测试按钮改读 `ApiStateStore` / `TaskApiClient`。
- `frontend/Model/ModelTaskSettingPage.py`
  切换到 `update_model()` 的 `threshold` patch。
- `frontend/Model/ModelAdvancedSettingPage.py`
  切换到 `update_model()` 的 `generation` / `request` patch。
- `frontend/Model/ModelSelectorPage.py`
  保留页面侧在线拉模型列表，只把保存入口切到 `update_model()`。
- `tests/api/client/test_app_client_context.py`
  断言 `AppClientContext` 已包含 `ModelApiClient`。
- `tests/frontend/test_frontend_core_boundary.py`
  新增 `MODEL_FRONTEND_FILES` 分组与 `Config` / `Engine` / `ModelManager` 禁止导入守卫。
- `api/SPEC.md`
  增补 `Model` 接口契约与 UI 边界声明。

### Notes

- `api/Application/__pycache__` 与 `api/Server/Routes/__pycache__` 中存在历史 `ModelAppService` / `ModelRoutes` 编译残留；实现前先确认源码不存在，再按当前计划落位，避免误以为已经有可复用实现。

## Task 1: 搭建模型 API 契约与对象模型

**Files:**
- Create: `model/Api/ModelModels.py`
- Create: `api/Contract/ModelPayloads.py`
- Modify: `model/Api/__init__.py`
- Modify: `api/SPEC.md`
- Test: `tests/api/application/test_model_app_service.py`

- [ ] **Step 1: 写模型快照与 payload 的失败测试**

```python
from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelGenerationSnapshot
from model.Api.ModelModels import ModelPageSnapshot
from model.Api.ModelModels import ModelRequestSnapshot
from model.Api.ModelModels import ModelThinkingSnapshot
from model.Api.ModelModels import ModelThresholdSnapshot


def test_model_page_snapshot_from_dict_builds_nested_objects() -> None:
    snapshot = ModelPageSnapshot.from_dict(
        {
            "active_model_id": "model-1",
            "models": [
                {
                    "id": "model-1",
                    "type": "PRESET",
                    "name": "GPT-4.1",
                    "api_format": "OpenAI",
                    "api_url": "https://api.example.com/v1",
                    "api_key": "secret",
                    "model_id": "gpt-4.1",
                    "request": {
                        "extra_headers": {"X-Test": "1"},
                        "extra_headers_custom_enable": True,
                        "extra_body": {"reasoning": "high"},
                        "extra_body_custom_enable": False,
                    },
                    "threshold": {
                        "input_token_limit": 1024,
                        "output_token_limit": 2048,
                        "rpm_limit": 60,
                        "concurrency_limit": 2,
                    },
                    "thinking": {"level": "HIGH"},
                    "generation": {
                        "temperature": 0.3,
                        "temperature_custom_enable": True,
                        "top_p": 0.8,
                        "top_p_custom_enable": True,
                        "presence_penalty": 0.1,
                        "presence_penalty_custom_enable": False,
                        "frequency_penalty": 0.2,
                        "frequency_penalty_custom_enable": True,
                    },
                }
            ],
        }
    )

    assert snapshot.active_model_id == "model-1"
    assert len(snapshot.models) == 1
    assert isinstance(snapshot.models[0], ModelEntrySnapshot)
    assert isinstance(snapshot.models[0].request, ModelRequestSnapshot)
    assert isinstance(snapshot.models[0].threshold, ModelThresholdSnapshot)
    assert isinstance(snapshot.models[0].thinking, ModelThinkingSnapshot)
    assert isinstance(snapshot.models[0].generation, ModelGenerationSnapshot)
    assert snapshot.models[0].generation.temperature == 0.3
```

Run: `uv run pytest tests/api/application/test_model_app_service.py::test_model_page_snapshot_from_dict_builds_nested_objects -v`
Expected: FAIL，提示 `model.Api.ModelModels` 或对应对象尚不存在。

- [ ] **Step 2: 实现冻结对象与 payload 基类**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Self


@dataclass(frozen=True)
class ModelRequestSnapshot:
    extra_headers: dict[str, str] = field(default_factory=dict)
    extra_headers_custom_enable: bool = False
    extra_body: dict[str, Any] = field(default_factory=dict)
    extra_body_custom_enable: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        normalized = data if isinstance(data, dict) else {}
        headers_raw = normalized.get("extra_headers", {})
        body_raw = normalized.get("extra_body", {})
        return cls(
            extra_headers=
            {str(key): str(value) for key, value in headers_raw.items()}
            if isinstance(headers_raw, dict)
            else {},
            extra_headers_custom_enable=bool(
                normalized.get("extra_headers_custom_enable", False)
            ),
            extra_body=dict(body_raw) if isinstance(body_raw, dict) else {},
            extra_body_custom_enable=bool(
                normalized.get("extra_body_custom_enable", False)
            ),
        )
```

```python
from dataclasses import dataclass
from typing import Any

from model.Api.ModelModels import ModelPageSnapshot


@dataclass(frozen=True)
class ModelPageSnapshotPayload:
    active_model_id: str
    models: list[dict[str, Any]]

    @classmethod
    def from_snapshot(cls, snapshot: ModelPageSnapshot) -> "ModelPageSnapshotPayload":
        return cls(
            active_model_id=snapshot.active_model_id,
            models=[model.to_dict() for model in snapshot.models],
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "active_model_id": self.active_model_id,
            "models": [dict(model) for model in self.models],
        }
```

- [ ] **Step 3: 导出模型对象并补充 API 规范**

```python
from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelGenerationSnapshot
from model.Api.ModelModels import ModelPageSnapshot
from model.Api.ModelModels import ModelRequestSnapshot
from model.Api.ModelModels import ModelThinkingSnapshot
from model.Api.ModelModels import ModelThresholdSnapshot

__all__.extend(
    [
        "ModelPageSnapshot",
        "ModelEntrySnapshot",
        "ModelRequestSnapshot",
        "ModelThresholdSnapshot",
        "ModelThinkingSnapshot",
        "ModelGenerationSnapshot",
    ]
)
```

```markdown
## 6.x Model 接口

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/models/snapshot` | `{}` | `{"snapshot": {...}}` |
| `POST` | `/api/models/update` | `{"model_id": "...", "patch": {...}}` | `{"snapshot": {...}}` |
| `POST` | `/api/models/activate` | `{"model_id": "..."}` | `{"snapshot": {...}}` |
| `POST` | `/api/models/add` | `{"model_type": "CUSTOM_OPENAI"}` | `{"snapshot": {...}}` |
| `POST` | `/api/models/delete` | `{"model_id": "..."}` | `{"snapshot": {...}}` |
| `POST` | `/api/models/reset-preset` | `{"model_id": "..."}` | `{"snapshot": {...}}` |
| `POST` | `/api/models/reorder` | `{"model_id": "...", "operation": "MOVE_UP"}` | `{"snapshot": {...}}` |
```

- [ ] **Step 4: 运行对象模型测试与基础格式化**

Run: `uv run pytest tests/api/application/test_model_app_service.py::test_model_page_snapshot_from_dict_builds_nested_objects -v`
Expected: PASS

Run: `uv run ruff format model/Api/ModelModels.py api/Contract/ModelPayloads.py model/Api/__init__.py`
Expected: `3 files left unchanged` 或 `1 file reformatted` 一类成功输出

Run: `uv run ruff check --fix model/Api/ModelModels.py api/Contract/ModelPayloads.py model/Api/__init__.py`
Expected: `All checks passed!`

## Task 2: 实现 ModelAppService、路由与客户端装配

**Files:**
- Create: `api/Application/ModelAppService.py`
- Create: `api/Server/Routes/ModelRoutes.py`
- Create: `api/Client/ModelApiClient.py`
- Modify: `api/Client/AppClientContext.py`
- Modify: `api/Server/ServerBootstrap.py`
- Modify: `app.py`
- Test: `tests/api/application/test_model_app_service.py`
- Test: `tests/api/client/test_model_api_client.py`
- Test: `tests/api/client/test_app_client_context.py`

- [ ] **Step 1: 写应用服务失败测试，覆盖 snapshot 与 patch 白名单**

```python
from api.Application.ModelAppService import ModelAppService


def test_model_app_service_update_model_rejects_forbidden_patch_key() -> None:
    service = ModelAppService()

    request = {
        "model_id": "model-1",
        "patch": {
            "type": "CUSTOM_OPENAI",
        },
    }

    with pytest.raises(ValueError, match="forbidden model patch key"):
        service.update_model(request)
```

```python
def test_model_app_service_snapshot_returns_active_model_and_models() -> None:
    service = ModelAppService()

    data = service.get_snapshot({})

    assert "snapshot" in data
    snapshot = data["snapshot"]
    assert snapshot["active_model_id"] != ""
    assert isinstance(snapshot["models"], list)
    assert snapshot["models"]
```

Run: `uv run pytest tests/api/application/test_model_app_service.py -v`
Expected: FAIL，提示 `ModelAppService` 不存在或方法未实现。

- [ ] **Step 2: 写客户端失败测试，覆盖客户端和路由装配**

```python
from api.Client.ApiClient import ApiClient
from api.Client.ModelApiClient import ModelApiClient


def test_model_api_client_get_snapshot_returns_model_page_snapshot(start_api_server) -> None:
    base_url = start_api_server()
    client = ModelApiClient(ApiClient(base_url))

    snapshot = client.get_snapshot()

    assert snapshot.active_model_id != ""
    assert snapshot.models
```

```python
def test_app_client_context_exposes_model_api_client(api_client) -> None:
    from api.Client.ModelApiClient import ModelApiClient
    from api.Client.AppClientContext import AppClientContext

    context = AppClientContext(
        project_api_client=ProjectApiClient(api_client),
        task_api_client=TaskApiClient(api_client),
        workbench_api_client=WorkbenchApiClient(api_client),
        settings_api_client=SettingsApiClient(api_client),
        quality_rule_api_client=QualityRuleApiClient(api_client),
        proofreading_api_client=ProofreadingApiClient(api_client),
        model_api_client=ModelApiClient(api_client),
        api_state_store=ApiStateStore(),
        extra_api_client=ExtraApiClient(api_client),
    )

    assert isinstance(context.model_api_client, ModelApiClient)
```

Run: `uv run pytest tests/api/client/test_model_api_client.py tests/api/client/test_app_client_context.py -v`
Expected: FAIL，提示 `ModelApiClient` 或 `model_api_client` 字段不存在。

- [ ] **Step 3: 实现应用服务、路由与客户端**

```python
class ModelAppService:
    PATCH_ALLOWED_KEYS: tuple[str, ...] = (
        "name",
        "api_url",
        "api_key",
        "model_id",
        "thinking",
        "threshold",
        "generation",
        "request",
    )

    def get_snapshot(self, request: dict[str, object] | None = None) -> dict[str, object]:
        del request
        config = Config().load()
        config.initialize_models()
        snapshot = self.build_snapshot(config)
        return {"snapshot": ModelPageSnapshotPayload.from_snapshot(snapshot).to_dict()}

    def update_model(self, request: dict[str, object]) -> dict[str, object]:
        model_id = str(request.get("model_id", ""))
        patch = request.get("patch", {})
        if not isinstance(patch, dict):
            raise ValueError("model patch must be a dict")
        for key in patch:
            if key not in self.PATCH_ALLOWED_KEYS:
                raise ValueError(f"forbidden model patch key: {key}")
        config = Config().load()
        config.initialize_models()
        model = dict(config.get_model(model_id) or {})
        if model == {}:
            raise ValueError("model not found")
        merged = self.apply_patch(model, patch)
        config.set_model(merged)
        config.save()
        return {"snapshot": ModelPageSnapshotPayload.from_snapshot(self.build_snapshot(config)).to_dict()}
```

```python
class ModelRoutes:
    SNAPSHOT_PATH: str = "/api/models/snapshot"
    UPDATE_PATH: str = "/api/models/update"
    ACTIVATE_PATH: str = "/api/models/activate"
    ADD_PATH: str = "/api/models/add"
    DELETE_PATH: str = "/api/models/delete"
    RESET_PRESET_PATH: str = "/api/models/reset-preset"
    REORDER_PATH: str = "/api/models/reorder"
```

```python
class ModelApiClient:
    def get_snapshot(self) -> ModelPageSnapshot:
        response = self.api_client.post(ModelRoutes.SNAPSHOT_PATH, {})
        return ModelPageSnapshot.from_dict(response.get("snapshot", {}))
```

- [ ] **Step 4: 接入启动装配**

```python
from api.Application.ModelAppService import ModelAppService
from api.Server.Routes.ModelRoutes import ModelRoutes

model_app_service = ModelAppService()
...
if model_app_service is not None:
    ModelRoutes.register(core_api_server, model_app_service)
```

```python
from api.Client.ModelApiClient import ModelApiClient

app_client_context = AppClientContext(
    project_api_client=ProjectApiClient(api_client),
    task_api_client=TaskApiClient(api_client),
    workbench_api_client=WorkbenchApiClient(api_client),
    settings_api_client=SettingsApiClient(api_client),
    quality_rule_api_client=QualityRuleApiClient(api_client),
    proofreading_api_client=ProofreadingApiClient(api_client),
    model_api_client=ModelApiClient(api_client),
    api_state_store=ApiStateStore(),
    extra_api_client=ExtraApiClient(api_client),
)
```

- [ ] **Step 5: 运行 API 层测试**

Run: `uv run pytest tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py tests/api/client/test_app_client_context.py -v`
Expected: PASS

Run: `uv run ruff format api/Application/ModelAppService.py api/Server/Routes/ModelRoutes.py api/Client/ModelApiClient.py api/Client/AppClientContext.py api/Server/ServerBootstrap.py app.py`
Expected: 成功格式化输出

Run: `uv run ruff check --fix api/Application/ModelAppService.py api/Server/Routes/ModelRoutes.py api/Client/ModelApiClient.py api/Client/AppClientContext.py api/Server/ServerBootstrap.py app.py`
Expected: `All checks passed!`

## Task 3: 迁移 ModelPage 的快照读取与资源动作

**Files:**
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/Model/ModelPage.py`
- Test: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 写前端边界失败测试，先锁住 ModelPage 不准直连 Core**

```python
MODEL_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Model/ModelPage.py",
)


def test_model_frontend_files_do_not_import_core_singletons() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    forbidden_imports = (
        "from module.Config import Config",
        "from module.Engine.Engine import Engine",
        "from module.ModelManager import ModelManager",
    )
    for relative_path in MODEL_FRONTEND_FILES:
        content = (root_dir / relative_path).read_text(encoding="utf-8")
        for forbidden_import in forbidden_imports:
            assert forbidden_import not in content
```

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py::test_model_frontend_files_do_not_import_core_singletons -v`
Expected: FAIL，因为 `ModelPage.py` 仍然导入 `Config` / `ModelManager`。

- [ ] **Step 2: 给 AppFluentWindow 注入 ModelApiClient**

```python
self.model_api_client = app_client_context.model_api_client
...
self.model_page = ModelPage(
    Localizer.get().app_model_page,
    self.model_api_client,
    self.api_state_store,
    self,
)
```

- [ ] **Step 3: 把 ModelPage 切到 snapshot 与动作接口**

```python
class ModelPage(Base, QWidget):
    def __init__(
        self,
        text: str,
        model_api_client: ModelApiClient,
        api_state_store: ApiStateStore,
        window: FluentWindow,
    ) -> None:
        super().__init__(window)
        self.model_api_client = model_api_client
        self.api_state_store = api_state_store
        self.current_snapshot: ModelPageSnapshot = self.model_api_client.get_snapshot()
```

```python
def activate_model(self, model_id: str, checked: bool = False) -> None:
    del checked
    self.current_snapshot = self.model_api_client.activate_model(model_id)
    self.refresh_all_categories()
```

```python
def add_model(self, model_type: ModelType, window: FluentWindow) -> None:
    del window
    self.current_snapshot = self.model_api_client.add_model(model_type.value)
    self.refresh_all_categories()
```

```python
def delete_model(self, model_id: str, checked: bool = False) -> None:
    del checked
    ...
    self.current_snapshot = self.model_api_client.delete_model(model_id)
    self.refresh_all_categories()
```

- [ ] **Step 4: 让 refresh_all_categories() 只基于当前 snapshot 渲染**

```python
def refresh_all_categories(self) -> None:
    models = [model.to_dict() for model in self.current_snapshot.models]
    active_model_id = self.current_snapshot.active_model_id
    ...
    self.update_category_card(card, model_type, models_by_type[model_type], active_model_id)
```

- [ ] **Step 5: 运行 ModelPage 相关测试**

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py::test_model_frontend_files_do_not_import_core_singletons -v`
Expected: PASS

Run: `uv run ruff format frontend/AppFluentWindow.py frontend/Model/ModelPage.py tests/frontend/test_frontend_core_boundary.py`
Expected: 成功格式化输出

Run: `uv run ruff check --fix frontend/AppFluentWindow.py frontend/Model/ModelPage.py tests/frontend/test_frontend_core_boundary.py`
Expected: `All checks passed!`

## Task 4: 迁移 Basic / Task / Advanced 三个设置弹窗

**Files:**
- Modify: `frontend/Model/ModelBasicSettingPage.py`
- Modify: `frontend/Model/ModelTaskSettingPage.py`
- Modify: `frontend/Model/ModelAdvancedSettingPage.py`
- Test: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 扩展边界测试到三个设置弹窗**

```python
MODEL_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Model/ModelPage.py",
    "frontend/Model/ModelBasicSettingPage.py",
    "frontend/Model/ModelTaskSettingPage.py",
    "frontend/Model/ModelAdvancedSettingPage.py",
)
```

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py::test_model_frontend_files_do_not_import_core_singletons -v`
Expected: FAIL，因为三个弹窗仍然导入 `Config`，基础设置页还导入 `Engine`。

- [ ] **Step 2: 把三个弹窗都改成接收 model_api_client 与初始 model snapshot**

```python
def __init__(
    self,
    model: ModelEntrySnapshot,
    model_api_client: ModelApiClient,
    api_state_store: ApiStateStore,
    window: FluentWindow,
) -> None:
    super().__init__(window)
    self.model = model
    self.model_api_client = model_api_client
    self.api_state_store = api_state_store
```

- [ ] **Step 3: 用 update_model() 替换直接 config 保存**

```python
def update_model_fields(self, patch: dict[str, object]) -> None:
    snapshot = self.model_api_client.update_model(self.model.id, patch)
    refreshed = next(
        (item for item in snapshot.models if item.id == self.model.id),
        self.model,
    )
    self.model = refreshed
```

```python
def on_current_index_changed(index: int) -> None:
    index_to_level = {0: "OFF", 1: "LOW", 2: "MEDIUM", 3: "HIGH"}
    self.update_model_fields(
        {
            "thinking": {
                "level": index_to_level.get(index, "OFF"),
            }
        }
    )
```

```python
def value_changed_input_token(spin_box: SpinBox) -> None:
    self.update_model_fields(
        {
            "threshold": {
                "input_token_limit": spin_box.value(),
            }
        }
    )
```

- [ ] **Step 4: 把测试按钮禁用逻辑改为读取任务快照**

```python
def update_test_button_status(self, event: Base.Event, data: dict) -> None:
    del event, data
    if self.model_id_test_button is None:
        return
    task_snapshot = self.api_state_store.task_snapshot
    is_busy = False if task_snapshot is None else bool(task_snapshot.busy)
    self.model_id_test_button.setEnabled(not is_busy)
```

- [ ] **Step 5: 运行三个弹窗相关检查**

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py::test_model_frontend_files_do_not_import_core_singletons -v`
Expected: PASS

Run: `uv run ruff format frontend/Model/ModelBasicSettingPage.py frontend/Model/ModelTaskSettingPage.py frontend/Model/ModelAdvancedSettingPage.py`
Expected: 成功格式化输出

Run: `uv run ruff check --fix frontend/Model/ModelBasicSettingPage.py frontend/Model/ModelTaskSettingPage.py frontend/Model/ModelAdvancedSettingPage.py`
Expected: `All checks passed!`

## Task 5: 迁移 ModelSelectorPage 的保存入口

**Files:**
- Modify: `frontend/Model/ModelSelectorPage.py`
- Modify: `frontend/Model/ModelBasicSettingPage.py`
- Test: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 扩展边界测试到 ModelSelectorPage**

```python
MODEL_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Model/ModelPage.py",
    "frontend/Model/ModelBasicSettingPage.py",
    "frontend/Model/ModelTaskSettingPage.py",
    "frontend/Model/ModelAdvancedSettingPage.py",
    "frontend/Model/ModelSelectorPage.py",
)
```

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py::test_model_frontend_files_do_not_import_core_singletons -v`
Expected: FAIL，因为 `ModelSelectorPage.py` 仍然导入 `Config`。

- [ ] **Step 2: 让 ModelSelectorPage 保留在线模型拉取，但从传入模型对象初始化**

```python
def __init__(
    self,
    model: ModelEntrySnapshot,
    model_api_client: ModelApiClient,
    window: FluentWindow,
) -> None:
    super().__init__(window)
    self.model = model
    self.model_api_client = model_api_client
    self.model_id = model.id
```

```python
def start_loading(self) -> None:
    api_key = self.model.api_key.split("\n")[0].strip()
    api_url = self.model.api_url
    api_format = self.model.api_format
    ...
```

- [ ] **Step 3: 把选中模型后的保存切到 update_model()**

```python
def on_item_clicked(self, item: QListWidgetItem) -> None:
    snapshot = self.model_api_client.update_model(
        self.model_id,
        {"model_id": item.text().strip()},
    )
    refreshed = next(
        (entry for entry in snapshot.models if entry.id == self.model_id),
        None,
    )
    if refreshed is not None:
        self.model = refreshed
    self.close()
```

- [ ] **Step 4: 调整 ModelBasicSettingPage 打开方式**

```python
def triggered_sync(checked: bool = False) -> None:
    del checked
    selector = ModelSelectorPage(self.model, self.model_api_client, window)
    selector.exec()
    self.model = selector.model
    ...
```

- [ ] **Step 5: 运行选择页与边界测试**

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py::test_model_frontend_files_do_not_import_core_singletons -v`
Expected: PASS

Run: `uv run ruff format frontend/Model/ModelSelectorPage.py frontend/Model/ModelBasicSettingPage.py`
Expected: 成功格式化输出

Run: `uv run ruff check --fix frontend/Model/ModelSelectorPage.py frontend/Model/ModelBasicSettingPage.py`
Expected: `All checks passed!`

## Task 6: 全链路回归与文档收尾

**Files:**
- Modify: `tests/api/client/conftest.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`
- Modify: `docs/FRONTEND.md`
- Modify: `api/SPEC.md`
- Test: `tests/api/client/test_model_api_client.py`
- Test: `tests/api/application/test_model_app_service.py`
- Test: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 补齐测试服务装配与前端边界断言**

```python
ServiceOverride = (
    ProjectAppService
    | ProofreadingAppService
    | QualityRuleAppService
    | TaskAppService
    | WorkbenchAppService
    | SettingsAppService
    | ExtraAppService
    | ModelAppService
)
```

```python
assert "frontend/Model/ModelPage.py" in MODEL_FRONTEND_FILES
assert "from module.Config import Config" not in model_page_content
assert "from module.Engine.Engine import Engine" not in model_basic_content
assert "from module.ModelManager import ModelManager" not in model_page_content
```

- [ ] **Step 2: 同步仓库文档入口**

```markdown
| 模型页 | [`frontend/Model/ModelPage.py`](../frontend/Model/ModelPage.py) | `api.Client.ModelApiClient`、模型配置与选择 |
```

```markdown
以下页面已要求只通过 `api.Client` 与 `ApiStateStore` 访问 Core：

- `frontend/Model/ModelPage.py`
- `frontend/Model/ModelBasicSettingPage.py`
- `frontend/Model/ModelTaskSettingPage.py`
- `frontend/Model/ModelAdvancedSettingPage.py`
- `frontend/Model/ModelSelectorPage.py`
```

- [ ] **Step 3: 运行完整验证**

Run: `uv run pytest tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: PASS

Run: `uv run pytest -v`
Expected: PASS；如果有与本改动无关的历史失败，记录失败用例名和堆栈摘要，再停止继续改动。

Run: `uv run ruff format api/Application/ModelAppService.py api/Server/Routes/ModelRoutes.py api/Client/ModelApiClient.py model/Api/ModelModels.py api/Contract/ModelPayloads.py api/Client/AppClientContext.py api/Server/ServerBootstrap.py app.py frontend/AppFluentWindow.py frontend/Model/ModelPage.py frontend/Model/ModelBasicSettingPage.py frontend/Model/ModelTaskSettingPage.py frontend/Model/ModelAdvancedSettingPage.py frontend/Model/ModelSelectorPage.py tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py`
Expected: 成功格式化输出

Run: `uv run ruff check --fix api/Application/ModelAppService.py api/Server/Routes/ModelRoutes.py api/Client/ModelApiClient.py model/Api/ModelModels.py api/Contract/ModelPayloads.py api/Client/AppClientContext.py api/Server/ServerBootstrap.py app.py frontend/AppFluentWindow.py frontend/Model/ModelPage.py frontend/Model/ModelBasicSettingPage.py frontend/Model/ModelTaskSettingPage.py frontend/Model/ModelAdvancedSettingPage.py frontend/Model/ModelSelectorPage.py tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py`
Expected: `All checks passed!`

## Self-Review

### Spec Coverage

- `Model` API 契约：Task 1、Task 2
- `AppClientContext` / `ServerBootstrap` / `app.py` 装配：Task 2
- `ModelPage` 动作迁移：Task 3
- Basic / Task / Advanced 三个设置弹窗 patch 迁移：Task 4
- `ModelSelectorPage` 保留在线拉取，仅迁移保存入口：Task 5
- 前端边界测试守卫：Task 3、Task 4、Task 5、Task 6
- 文档同步：Task 1、Task 6

### Placeholder Scan

- 本计划未使用任何占位写法，所有任务都给出明确文件路径、测试命令与关键代码骨架。
- 如果执行中发现测试目录已有同名文件，先读取再合并，不要覆盖用户已有内容。

### Type Consistency

- 客户端返回对象统一为 `ModelPageSnapshot`
- 页面内部统一消费 `ModelEntrySnapshot`
- UI 写入口统一使用 `update_model(model_id, patch)`
- 动作接口命名统一为 `activate_model`、`add_model`、`delete_model`、`reset_preset_model`、`reorder_model`
