# Extra UI/Core 分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `frontend/Extra/*` 从直接读写 `Config`、`DataManager`、`Engine`、`FileManager`、`TextProcessor` 的结构，迁移为只消费 `api.Client` 与对象化 API 模型的纯 UI 层。

**Architecture:** 先补齐 `Extra` 领域的对象模型、边界守卫与路由契约，再按 `Laboratory`、`TSConversion`、`NameFieldExtraction` 三条业务线，把业务逻辑下沉到 `module/Data/Extra/*`，并通过 `api/Application/ExtraAppService`、`api/Server/Routes/ExtraRoutes.py`、`api/Client/ExtraApiClient.py` 建立稳定边界。UI 侧由 `app.py` 与 `AppFluentWindow` 注入新客户端，`frontend/Extra/*` 只保留展示态与交互编排；长任务进度通过 SSE 进入 `ApiStateStore`，页面不再直接依赖 Core 单例。

**Tech Stack:** Python 3.14、PySide6、httpx、pytest、Ruff、现有 `api.Client` / `ApiStateStore` / `ServerBootstrap` / `DataManager` / `Engine`

---

## 0. 文件结构映射

### 新建文件

- Create: `api/Contract/ExtraPayloads.py`
- Create: `api/Application/ExtraAppService.py`
- Create: `api/Client/ExtraApiClient.py`
- Create: `api/Server/Routes/ExtraRoutes.py`
- Create: `model/Api/ExtraModels.py`
- Create: `module/Data/Extra/TsConversionService.py`
- Create: `module/Data/Extra/NameFieldExtractionService.py`
- Create: `module/Data/Extra/LaboratoryService.py`
- Create: `tests/api/test_extra_app_service.py`
- Create: `tests/api/client/test_extra_api_client.py`
- Create: `tests/module/data/test_ts_conversion_service.py`
- Create: `tests/module/data/test_name_field_extraction_service.py`
- Create: `tests/module/data/test_laboratory_service.py`

### 修改文件

- Modify: `api/Application/__init__.py`
- Modify: `api/Bridge/EventTopic.py`
- Modify: `api/Bridge/EventBridge.py`
- Modify: `api/Client/__init__.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `api/Client/AppClientContext.py`
- Modify: `api/Client/SseClient.py`
- Modify: `api/Server/ServerBootstrap.py`
- Modify: `api/Server/Routes/__init__.py`
- Modify: `app.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/Extra/ToolBoxPage.py`
- Modify: `frontend/Extra/TSConversionPage.py`
- Modify: `frontend/Extra/NameFieldExtractionPage.py`
- Modify: `frontend/Extra/LaboratoryPage.py`
- Modify: `model/Api/__init__.py`
- Modify: `tests/api/client/test_app_client_context.py`
- Modify: `tests/api/test_api_spec_contract.py`
- Modify: `tests/api/test_event_bridge.py`
- Modify: `tests/api/test_api_state_store.py`
- Modify: `tests/api/test_sse_client.py`
- Modify: `tests/api/server/route_contracts.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`
- Modify: `api/SPEC.md`

### 参考文件

- Check: `docs/superpowers/specs/2026-03-26-extra-ui-core-separation-design.md`
- Check: `api/Application/SettingsAppService.py`
- Check: `api/Server/Routes/TaskRoutes.py`
- Check: `api/Client/TaskApiClient.py`
- Check: `api/Client/AppClientContext.py`
- Check: `api/Client/ApiStateStore.py`
- Check: `frontend/AppFluentWindow.py`
- Check: `frontend/Extra/TSConversionPage.py`
- Check: `frontend/Extra/NameFieldExtractionPage.py`
- Check: `frontend/Extra/LaboratoryPage.py`
- Check: `frontend/Extra/ToolBoxPage.py`

### 计划约束

- 本计划只覆盖一个子系统：`Extra` UI/Core 分离，不再继续扩展 `Model` 页或其他目录。
- 每个任务都先写失败测试，再做最小实现，再运行验证，再单独提交。
- 任何一步都不得让 `frontend/Extra/*` 重新增加对 `module.Config`、`module.Data.DataManager`、`module.Engine.Engine`、`module.File.FileManager`、`module.TextProcessor` 的直接依赖。
- 页面层只允许保留展示态：选中项、搜索词、编辑草稿、按钮忙碌态。

## 1. 里程碑

| 里程碑 | 闭环结果 |
| --- | --- |
| `M1` | `Extra` 对象模型、路由契约与目录级 boundary 守卫建立 |
| `M2` | `Laboratory` 完成 API 化，页面不再直读 `Config` / `Engine` |
| `M3` | `TSConversion` 完成长任务化与 SSE 进度闭环 |
| `M4` | `NameFieldExtraction` 完成提取、翻译、导入 glossary 的 API 化 |
| `M5` | `AppClientContext`、`app.py`、`AppFluentWindow` 与全部 `frontend/Extra/*` 完成迁移 |
| `M6` | `api/SPEC.md`、测试、格式检查与最小手动路径全部收口 |

## 2. 任务清单

### Task 1: 固定 `Extra` 边界、路由契约与对象模型

**Files:**
- Create: `model/Api/ExtraModels.py`
- Create: `tests/api/client/test_extra_api_client.py`
- Modify: `model/Api/__init__.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`
- Modify: `tests/api/server/route_contracts.py`
- Modify: `tests/api/test_api_spec_contract.py`
- Modify: `tests/api/client/test_app_client_context.py`

- [ ] **Step 1: 先写失败测试，固定 `Extra` 文件清单、禁止导入、客户端入口与路由契约**

```python
EXTRA_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Extra/ToolBoxPage.py",
    "frontend/Extra/TSConversionPage.py",
    "frontend/Extra/NameFieldExtractionPage.py",
    "frontend/Extra/LaboratoryPage.py",
)

EXTRA_FORBIDDEN_IMPORTS: tuple[str, ...] = (
    "from module.Config import Config",
    "from module.Data.DataManager import DataManager",
    "from module.Engine.Engine import Engine",
    "from module.File.FileManager import FileManager",
    "from module.TextProcessor import TextProcessor",
)


def test_extra_frontend_files_are_listed_separately() -> None:
    assert EXTRA_FRONTEND_FILES
    assert len(set(EXTRA_FRONTEND_FILES)) == len(EXTRA_FRONTEND_FILES)


def test_extra_frontend_files_do_not_import_core_singletons_directly() -> None:
    for relative_path in EXTRA_FRONTEND_FILES:
        content = (root_dir / relative_path).read_text(encoding="utf-8")
        for forbidden_import in EXTRA_FORBIDDEN_IMPORTS:
            assert forbidden_import not in content


def test_extra_routes_are_documented_in_route_contracts() -> None:
    assert "/api/extra/ts-conversion/options" in PHASE_THREE_EXTRA_ROUTE_PATHS
    assert "/api/extra/name-fields/translate" in PHASE_THREE_EXTRA_ROUTE_PATHS


def test_app_client_context_will_expose_extra_api_client() -> None:
    assert "extra_api_client" in context.__annotations__
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py tests/api/test_api_spec_contract.py tests/api/client/test_app_client_context.py -v`
Expected: FAIL，提示 `Extra` 文件清单与 forbidden imports 断言尚未建立，`AppClientContext` 还没有 `extra_api_client`，路由契约也还没有 `Extra` 路径。

- [ ] **Step 3: 实现最小对象模型、导出与契约常量**

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class TsConversionOptionsSnapshot:
    default_direction: str
    preserve_text_enabled: bool
    convert_name_enabled: bool

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "TsConversionOptionsSnapshot":
        return cls(
            default_direction=str(data.get("default_direction", "TO_TRADITIONAL")),
            preserve_text_enabled=bool(data.get("preserve_text_enabled", True)),
            convert_name_enabled=bool(data.get("convert_name_enabled", True)),
        )


@dataclass(frozen=True)
class LaboratorySnapshot:
    mtool_optimizer_enabled: bool
    force_thinking_enabled: bool
```

要求：

- `model/Api/ExtraModels.py` 至少定义 `TsConversionOptionsSnapshot`、`TsConversionTaskAccepted`、`NameFieldEntryDraft`、`NameFieldSnapshot`、`NameFieldTranslateResult`、`LaboratorySnapshot`、`ExtraToolEntry`、`ExtraToolSnapshot`
- `model/Api/__init__.py` 导出这些新对象
- `tests/api/server/route_contracts.py` 新增 `PHASE_THREE_EXTRA_ROUTE_PATHS`
- `tests/frontend/test_frontend_core_boundary.py` 新增 `Extra` 专属守卫

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/frontend/test_frontend_core_boundary.py tests/api/test_api_spec_contract.py tests/api/client/test_app_client_context.py -v`
Expected: PASS，`Extra` 边界守卫、路由契约常量与对象模型已成型。

- [ ] **Step 5: 提交**

```bash
git add model/Api/__init__.py model/Api/ExtraModels.py tests/frontend/test_frontend_core_boundary.py tests/api/server/route_contracts.py tests/api/test_api_spec_contract.py tests/api/client/test_app_client_context.py
git commit -m "test: add extra boundary and api model contracts"
```

### Task 2: 下沉 `Laboratory` 为最小打样路径

**Files:**
- Create: `module/Data/Extra/LaboratoryService.py`
- Create: `tests/module/data/test_laboratory_service.py`
- Create: `tests/api/test_extra_app_service.py`
- Create: `api/Contract/ExtraPayloads.py`
- Create: `api/Application/ExtraAppService.py`
- Create: `api/Client/ExtraApiClient.py`
- Create: `api/Server/Routes/ExtraRoutes.py`
- Modify: `api/Application/__init__.py`
- Modify: `api/Client/__init__.py`
- Modify: `api/Server/Routes/__init__.py`
- Modify: `api/Server/ServerBootstrap.py`
- Modify: `frontend/Extra/LaboratoryPage.py`

- [ ] **Step 1: 先写失败测试，固定 `Laboratory` 快照、更新接口与页面入口**

```python
def test_laboratory_service_returns_snapshot(fake_config) -> None:
    service = LaboratoryService(config_loader=lambda: fake_config)
    snapshot = service.get_snapshot()
    assert snapshot["mtool_optimizer_enabled"] is False
    assert snapshot["force_thinking_enabled"] is True


def test_extra_app_service_updates_laboratory_settings(fake_config) -> None:
    service = ExtraAppService(laboratory_service=LaboratoryService(config_loader=lambda: fake_config))
    result = service.update_laboratory_settings({"mtool_optimizer_enabled": True})
    assert result["snapshot"]["mtool_optimizer_enabled"] is True


def test_laboratory_page_uses_extra_api_client() -> None:
    assert "from api.Client.ExtraApiClient import ExtraApiClient" in page_content
    assert "from module.Config import Config" not in page_content
    assert "from module.Engine.Engine import Engine" not in page_content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/module/data/test_laboratory_service.py tests/api/test_extra_app_service.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `LaboratoryService`、`ExtraAppService`、`ExtraApiClient`、`ExtraRoutes` 均不存在，`LaboratoryPage` 仍然直连 `Config` / `Engine`。

- [ ] **Step 3: 写最小实现，先打通 `snapshot` / `update` 闭环**

```python
class LaboratoryService:
    def __init__(self, config_loader: Callable[[], Config] | None = None) -> None:
        self.config_loader = config_loader or Config

    def get_snapshot(self) -> dict[str, object]:
        config = self.config_loader().load()
        return {
            "mtool_optimizer_enabled": bool(config.mtool_optimizer_enable),
            "force_thinking_enabled": bool(config.force_thinking_enable),
        }

    def update_settings(self, request: dict[str, object]) -> dict[str, object]:
        config = self.config_loader().load()
        if "mtool_optimizer_enabled" in request:
            config.mtool_optimizer_enable = bool(request["mtool_optimizer_enabled"])
        if "force_thinking_enabled" in request:
            config.force_thinking_enable = bool(request["force_thinking_enabled"])
        config.save()
        return self.get_snapshot()
```

要求：

- `ExtraPayloads.py` 增加 `LaboratorySnapshotPayload`
- `ExtraAppService` 先实现 `get_laboratory_snapshot()` 与 `update_laboratory_settings()`
- `ExtraRoutes.py` 先注册 `POST /api/extra/laboratory/snapshot` 与 `POST /api/extra/laboratory/update`
- `ExtraApiClient` 先实现 `get_laboratory_snapshot()` 与 `update_laboratory_settings()`
- `LaboratoryPage` 从 `ExtraApiClient` 拉快照，从 `TaskApiClient` 读忙碌态，不再直接使用 `Config()` 和 `Engine.get()`

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/module/data/test_laboratory_service.py tests/api/test_extra_app_service.py tests/frontend/test_frontend_core_boundary.py tests/api/client/test_extra_api_client.py -v`
Expected: PASS，`Laboratory` 已成为 `Extra` 的第一条 API 化闭环。

- [ ] **Step 5: 提交**

```bash
git add module/Data/Extra/LaboratoryService.py api/Contract/ExtraPayloads.py api/Application/ExtraAppService.py api/Client/ExtraApiClient.py api/Server/Routes/ExtraRoutes.py api/Application/__init__.py api/Client/__init__.py api/Server/Routes/__init__.py api/Server/ServerBootstrap.py frontend/Extra/LaboratoryPage.py tests/module/data/test_laboratory_service.py tests/api/test_extra_app_service.py tests/api/client/test_extra_api_client.py tests/frontend/test_frontend_core_boundary.py
git commit -m "feat: add laboratory extra api flow"
```

### Task 3: 下沉 `TSConversion` 并建立 SSE 进度协议

**Files:**
- Create: `module/Data/Extra/TsConversionService.py`
- Create: `tests/module/data/test_ts_conversion_service.py`
- Modify: `api/Contract/ExtraPayloads.py`
- Modify: `api/Application/ExtraAppService.py`
- Modify: `api/Bridge/EventTopic.py`
- Modify: `api/Bridge/EventBridge.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `api/Client/SseClient.py`
- Modify: `api/Client/ExtraApiClient.py`
- Modify: `frontend/Extra/TSConversionPage.py`
- Modify: `tests/api/test_event_bridge.py`
- Modify: `tests/api/test_api_state_store.py`
- Modify: `tests/api/test_sse_client.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 先写失败测试，固定转换 options、开始命令与 SSE topic**

```python
def test_ts_conversion_service_builds_default_options() -> None:
    options = TsConversionService().get_options_snapshot()
    assert options["default_direction"] == "TO_TRADITIONAL"
    assert options["preserve_text_enabled"] is True


def test_start_ts_conversion_returns_task_payload(extra_app_service) -> None:
    result = extra_app_service.start_ts_conversion(
        {"direction": "TO_SIMPLIFIED", "preserve_text": True, "convert_name": False}
    )
    assert result["task"]["task_id"] == "extra_ts_conversion"
    assert result["task"]["accepted"] is True


def test_event_bridge_maps_extra_progress_topic() -> None:
    topic, payload = EventBridge().map_event(
        Base.Event.EXTRA_TS_CONVERSION_PROGRESS,
        {"current": 2, "total": 10, "message": "running"},
    )
    assert topic == "extra.ts_conversion_progress"
    assert payload["current"] == 2


def test_ts_conversion_page_uses_extra_api_client() -> None:
    assert "from api.Client.ExtraApiClient import ExtraApiClient" in page_content
    assert "from module.Data.DataManager import DataManager" not in page_content
    assert "from module.File.FileManager import FileManager" not in page_content
    assert "from module.TextProcessor import TextProcessor" not in page_content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/module/data/test_ts_conversion_service.py tests/api/test_extra_app_service.py tests/api/test_event_bridge.py tests/api/test_api_state_store.py tests/api/test_sse_client.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `TsConversionService` 未实现，`EventTopic` / `EventBridge` / `ApiStateStore` 还不认识 `Extra` 进度事件，页面仍直连 Core。

- [ ] **Step 3: 写最小实现，先打通 options、start 与事件合并**

```python
class TsConversionService:
    TASK_ID: str = "extra_ts_conversion"

    def get_options_snapshot(self) -> dict[str, object]:
        return {
            "default_direction": "TO_TRADITIONAL",
            "preserve_text_enabled": True,
            "convert_name_enabled": True,
        }

    def start_conversion(
        self,
        request: dict[str, object],
        progress_callback: Callable[[dict[str, object]], None],
    ) -> dict[str, object]:
        del request
        progress_callback({"current": 0, "total": 1, "message": "preparing"})
        return {"task_id": self.TASK_ID, "accepted": True}
```

要求：

- 先用最小线程包装把原 `TSConversionPage` 中的业务逻辑搬到 `TsConversionService`
- `ExtraAppService.start_ts_conversion()` 负责启动任务并返回 `TsConversionTaskAccepted`
- `EventTopic.py` 新增 `EXTRA_TS_CONVERSION_PROGRESS`、`EXTRA_TS_CONVERSION_FINISHED`
- `EventBridge.py` 映射新的 `Base.Event.EXTRA_TS_CONVERSION_PROGRESS` / `FINISHED`
- `ApiStateStore` 新增 `extra_task_state` 或等价的最小缓存对象，至少能保存 `task_id`、`message`、`current`、`total`、`finished`
- `SseClient` 在遇到 `extra.ts_conversion_progress` / `extra.ts_conversion_finished` 时合并进状态仓库
- `TSConversionPage` 通过 `ExtraApiClient` 获取 options、启动任务，通过 `ApiStateStore` 读取进度，不再自行开工作线程

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/module/data/test_ts_conversion_service.py tests/api/test_extra_app_service.py tests/api/test_event_bridge.py tests/api/test_api_state_store.py tests/api/test_sse_client.py tests/api/client/test_extra_api_client.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: PASS，`TSConversion` 已完成最小长任务闭环。

- [ ] **Step 5: 提交**

```bash
git add module/Data/Extra/TsConversionService.py api/Contract/ExtraPayloads.py api/Application/ExtraAppService.py api/Bridge/EventTopic.py api/Bridge/EventBridge.py api/Client/ApiStateStore.py api/Client/SseClient.py api/Client/ExtraApiClient.py frontend/Extra/TSConversionPage.py tests/module/data/test_ts_conversion_service.py tests/api/test_event_bridge.py tests/api/test_api_state_store.py tests/api/test_sse_client.py tests/api/client/test_extra_api_client.py tests/frontend/test_frontend_core_boundary.py
git commit -m "feat: migrate ts conversion to extra api"
```

### Task 4: 下沉 `NameFieldExtraction` 的提取、翻译与 glossary 写入

**Files:**
- Create: `module/Data/Extra/NameFieldExtractionService.py`
- Create: `tests/module/data/test_name_field_extraction_service.py`
- Modify: `api/Contract/ExtraPayloads.py`
- Modify: `api/Application/ExtraAppService.py`
- Modify: `api/Client/ExtraApiClient.py`
- Modify: `frontend/Extra/NameFieldExtractionPage.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 先写失败测试，固定快照、翻译汇总与 glossary 导入语义**

```python
def test_name_field_extraction_service_extracts_unique_names(fake_data_manager) -> None:
    service = NameFieldExtractionService(data_manager_getter=lambda: fake_data_manager)
    snapshot = service.extract_name_fields()
    assert snapshot["items"][0]["src"] == "勇者"
    assert snapshot["items"][0]["context"] == "勇者が来た"


def test_translate_name_fields_returns_success_and_failure_counts(fake_engine) -> None:
    service = NameFieldExtractionService(engine_getter=lambda: fake_engine)
    result = service.translate_name_fields(
        [{"src": "勇者", "dst": "", "context": "勇者が来た", "status": "NONE"}]
    )
    assert result["success_count"] == 1
    assert result["failed_count"] == 0
    assert result["items"][0]["dst"] == "Hero"


def test_save_name_fields_to_glossary_merges_existing_entries(fake_data_manager) -> None:
    service = NameFieldExtractionService(data_manager_getter=lambda: fake_data_manager)
    service.save_name_fields_to_glossary(
        [{"src": "勇者", "dst": "Hero", "context": "勇者が来た", "status": "PROCESSED"}]
    )
    assert fake_data_manager.saved_glossary[0]["dst"] == "Hero"


def test_name_field_page_uses_extra_api_client() -> None:
    assert "from api.Client.ExtraApiClient import ExtraApiClient" in page_content
    assert "from module.Data.DataManager import DataManager" not in page_content
    assert "from module.Engine.Engine import Engine" not in page_content
    assert "from module.Config import Config" not in page_content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/module/data/test_name_field_extraction_service.py tests/api/test_extra_app_service.py tests/api/client/test_extra_api_client.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `NameFieldExtractionService` 未实现，页面仍直连 `DataManager` / `Engine` / `Config`。

- [ ] **Step 3: 写最小实现，先用“整表回写”模型替代逐行 patch**

```python
class NameFieldExtractionService:
    def extract_name_fields(self) -> dict[str, object]:
        return {
            "items": [
                {
                    "src": "勇者",
                    "dst": "",
                    "context": "勇者が来た",
                    "status": "NONE",
                }
            ]
        }

    def translate_name_fields(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        return {"success_count": 0, "failed_count": 0, "items": items}
```

要求：

- `extract_name_fields()` 负责从工程条目中生成唯一姓名草稿
- `translate_name_fields()` 返回 `success_count`、`failed_count` 与完整更新后 `items`
- `save_name_fields_to_glossary()` 负责合并现有 glossary 并保存
- `ExtraAppService` 新增对应四个方法：`get_name_field_snapshot()`、`extract_name_fields()`、`translate_name_fields()`、`save_name_fields_to_glossary()`
- `NameFieldExtractionPage` 只保留表格渲染、搜索、编辑草稿与调用 `ExtraApiClient`
- 页面内不再直接调用 `Engine.get().translate_single_item()` 或 `DataManager.get().set_glossary()`

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/module/data/test_name_field_extraction_service.py tests/api/test_extra_app_service.py tests/api/client/test_extra_api_client.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: PASS，姓名提取、批量翻译与 glossary 写入已全部通过 `Extra` API 边界完成。

- [ ] **Step 5: 提交**

```bash
git add module/Data/Extra/NameFieldExtractionService.py api/Contract/ExtraPayloads.py api/Application/ExtraAppService.py api/Client/ExtraApiClient.py frontend/Extra/NameFieldExtractionPage.py tests/module/data/test_name_field_extraction_service.py tests/api/test_extra_app_service.py tests/api/client/test_extra_api_client.py tests/frontend/test_frontend_core_boundary.py
git commit -m "feat: migrate name field extraction to extra api"
```

### Task 5: 接入 `app.py`、`AppClientContext`、`AppFluentWindow` 与全部 `frontend/Extra/*`

**Files:**
- Modify: `api/Client/__init__.py`
- Modify: `api/Client/AppClientContext.py`
- Modify: `app.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/Extra/ToolBoxPage.py`
- Modify: `frontend/Extra/TSConversionPage.py`
- Modify: `frontend/Extra/NameFieldExtractionPage.py`
- Modify: `frontend/Extra/LaboratoryPage.py`
- Modify: `tests/api/client/test_app_client_context.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`

- [ ] **Step 1: 先写失败测试，固定新客户端注入与窗口 wiring**

```python
def test_app_client_context_groups_extra_api_client() -> None:
    context = AppClientContext(
        project_api_client=ProjectApiClient(api_client),
        task_api_client=TaskApiClient(api_client),
        workbench_api_client=WorkbenchApiClient(api_client),
        settings_api_client=SettingsApiClient(api_client),
        quality_rule_api_client=QualityRuleApiClient(api_client),
        proofreading_api_client=ProofreadingApiClient(api_client),
        extra_api_client=ExtraApiClient(api_client),
        api_state_store=ApiStateStore(),
    )
    assert isinstance(context.extra_api_client, ExtraApiClient)


def test_ui_bootstrap_imports_extra_api_client() -> None:
    assert "extra_api_client=ExtraApiClient(api_client)" in app_content
    assert "self.extra_api_client = app_client_context.extra_api_client" in window_content
    assert "ExtraApiClient" in extra_page_content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `AppClientContext`、`app.py`、`AppFluentWindow` 还没有 `extra_api_client`，`ToolBoxPage` 与其他 `Extra` 页面也还没有新构造签名。

- [ ] **Step 3: 写最小实现，统一把 `ExtraApiClient` 与 `ApiStateStore` 注入页面**

```python
@dataclass(frozen=True)
class AppClientContext:
    project_api_client: ProjectApiClient
    task_api_client: TaskApiClient
    workbench_api_client: WorkbenchApiClient
    settings_api_client: SettingsApiClient
    quality_rule_api_client: QualityRuleApiClient
    proofreading_api_client: ProofreadingApiClient
    extra_api_client: ExtraApiClient
    api_state_store: ApiStateStore
```

要求：

- `api/Client/__init__.py` 导出 `ExtraApiClient`
- `app.py` 构造 `AppClientContext` 时注入 `ExtraApiClient(api_client)`
- `AppFluentWindow` 保存 `self.extra_api_client`
- `add_extra_pages()` 传入 `extra_api_client` 与需要的 `api_state_store` / `task_api_client`
- `ToolBoxPage` 去掉 `Config` 依赖，只保留纯导航
- `TSConversionPage`、`NameFieldExtractionPage`、`LaboratoryPage` 改为显式接收客户端对象，不再在页面内创建 Core 依赖

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py tests/api/client/test_extra_api_client.py -v`
Expected: PASS，`Extra` 新客户端已从 UI 启动入口一路注入到页面层。

- [ ] **Step 5: 提交**

```bash
git add api/Client/__init__.py api/Client/AppClientContext.py app.py frontend/AppFluentWindow.py frontend/Extra/ToolBoxPage.py frontend/Extra/TSConversionPage.py frontend/Extra/NameFieldExtractionPage.py frontend/Extra/LaboratoryPage.py tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py
git commit -m "refactor: wire extra api client into ui"
```

### Task 6: 更新契约文档、补齐验证并完成收口

**Files:**
- Modify: `api/SPEC.md`
- Modify: `tests/api/test_api_spec_contract.py`
- Modify: `tests/api/server/route_contracts.py`
- Modify: `tests/frontend/test_frontend_core_boundary.py`
- Modify: `tests/api/test_event_bridge.py`
- Modify: `tests/api/test_api_state_store.py`
- Modify: `tests/api/test_sse_client.py`

- [ ] **Step 1: 先写失败测试，固定 `Extra` 契约、topic 与最终边界**

```python
def test_api_spec_documents_extra_routes_topics_and_errors() -> None:
    assert "/api/extra/ts-conversion/options" in spec_content
    assert "/api/extra/name-fields/extract" in spec_content
    assert "/api/extra/laboratory/update" in spec_content
    assert "extra.ts_conversion_progress" in spec_content
    assert "NO_PROJECT" in spec_content
    assert "TASK_RUNNING" in spec_content


def test_sse_client_merges_extra_task_events() -> None:
    store = ApiStateStore()
    client = SseClient("http://testserver", store)
    client.dispatch_event(
        "extra.ts_conversion_progress",
        ['{"task_id":"extra_ts_conversion","message":"running","current":1,"total":2}'],
    )
    assert store.get_extra_task_state("extra_ts_conversion").current == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_spec_contract.py tests/api/test_event_bridge.py tests/api/test_api_state_store.py tests/api/test_sse_client.py tests/frontend/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `api/SPEC.md` 还没有 `Extra` 契约，`ApiStateStore` 还没有统一对外读取方法或最终边界仍有回退。

- [ ] **Step 3: 更新 `api/SPEC.md` 并补齐最终验证点**

```text
POST /api/extra/ts-conversion/options
POST /api/extra/ts-conversion/start
POST /api/extra/name-fields/snapshot
POST /api/extra/name-fields/extract
POST /api/extra/name-fields/translate
POST /api/extra/name-fields/save-to-glossary
POST /api/extra/laboratory/snapshot
POST /api/extra/laboratory/update
```

要求：

- `api/SPEC.md` 补齐 `Extra` 路由、请求体/响应体示例、错误码、SSE topic
- `tests/frontend/test_frontend_core_boundary.py` 最终断言整个 `frontend/Extra/*` 不再出现 `Config().load()`、`DataManager.get()`、`Engine.get()` 等直连语义
- `tests/api/test_api_state_store.py` 为 `extra task state` 提供只读读取断言
- `tests/api/test_sse_client.py` 覆盖 `extra.ts_conversion_progress` 与 `extra.ts_conversion_finished`

- [ ] **Step 4: 运行完整验证**

Run: `uv run pytest tests/module/data/test_laboratory_service.py tests/module/data/test_ts_conversion_service.py tests/module/data/test_name_field_extraction_service.py tests/api/test_extra_app_service.py tests/api/test_event_bridge.py tests/api/test_api_state_store.py tests/api/test_sse_client.py tests/api/client/test_extra_api_client.py tests/api/client/test_app_client_context.py tests/frontend/test_frontend_core_boundary.py tests/api/test_api_spec_contract.py -v`
Expected: PASS，`Extra` 模块、API、客户端、SSE、边界与文档契约全部通过。

Run: `uv run ruff format api model frontend module tests app.py`
Expected: PASS。

Run: `uv run ruff check --fix api model frontend module tests app.py`
Expected: PASS。

Run: `rg -n "from module\\.Config import Config|from module\\.Data\\.DataManager import DataManager|from module\\.Engine\\.Engine import Engine|from module\\.File\\.FileManager import FileManager|from module\\.TextProcessor import TextProcessor|Config\\(\\)\\.load\\(|DataManager\\.get\\(|Engine\\.get\\(" frontend/Extra -S`
Expected: 无结果。

- [ ] **Step 5: 提交**

```bash
git add api/SPEC.md tests/api tests/frontend/test_frontend_core_boundary.py
git commit -m "docs: finalize extra api contract"
```

## 3. 执行提示

- `Laboratory` 先落地，是为了先验证 `ExtraRoutes`、`ExtraAppService`、`ExtraApiClient` 的最小骨架，不要跳过它。
- `TSConversion` 的最小目标不是一开始就把所有进度 UI 做得完美，而是先把“开始任务 + 进度事件 + 完成事件 + 页面不直连 Core”闭环做出来。
- `NameFieldExtractionPage` 的整表草稿回写不要过度优化成 patch 协议；本轮目标是简单稳定地替换原页面里的 Core 调用。
- 如果 `Base.Event` 中还没有 `EXTRA_TS_CONVERSION_PROGRESS` / `FINISHED`，在实现对应任务时新增即可，但不要顺手扩散成别的 Extra 通用事件体系。
- 若 `ApiStateStore` 需要支持多个 `Extra` 任务，优先以 `task_id -> frozen state` 的最小字典缓存实现，不要抽象成复杂发布订阅中心。

