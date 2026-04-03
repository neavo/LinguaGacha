# Quality / Proofreading Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `frontend/Quality/**` 与 `frontend/Proofreading/**` 的完整业务迁移到 `api/` 与 `module/Data` 边界后方，让 UI 只消费对象化快照与增量命令结果。

**Architecture:** 先把 `Proofreading` 与 `Quality` 的纯业务逻辑下沉到 `module/Data/Quality`、`module/Data/Proofreading`，再在 `api/Application`、`api/Server`、`api/Client` 上建立稳定的快照/命令接口。UI 侧通过新增客户端消费完整快照与增量结果，SSE 只负责失效通知与长操作进度，不再直接依赖 `DataManager`、`Config`、`ResultChecker`、`QualityRule` 实现。

**Tech Stack:** Python 3.14、PySide6、httpx、pytest、Ruff、现有 `DataManager` / `ResultChecker` / `api.Client`

---

## 0. 文件结构映射

### 新建文件

- Create: `api/Contract/QualityPayloads.py`, `api/Contract/PromptPayloads.py`, `api/Contract/ProofreadingPayloads.py`
- Create: `api/Application/QualityRuleAppService.py`, `api/Application/ProofreadingAppService.py`
- Create: `api/Server/Routes/QualityRoutes.py`, `api/Server/Routes/ProofreadingRoutes.py`
- Create: `api/Client/QualityRuleApiClient.py`, `api/Client/ProofreadingApiClient.py`
- Create: `model/Api/QualityRuleModels.py`, `model/Api/PromptModels.py`, `model/Api/ProofreadingModels.py`
- Create: `module/Data/Quality/QualityRuleFacadeService.py`, `module/Data/Quality/QualityRuleSnapshotService.py`, `module/Data/Quality/QualityRuleMutationService.py`, `module/Data/Quality/QualityRulePresetService.py`, `module/Data/Quality/PromptService.py`
- Create: `module/Data/Proofreading/ProofreadingSnapshotService.py`, `module/Data/Proofreading/ProofreadingFilterService.py`, `module/Data/Proofreading/ProofreadingMutationService.py`, `module/Data/Proofreading/ProofreadingRecheckService.py`, `module/Data/Proofreading/ProofreadingRevisionService.py`
- Create: `tests/api/test_quality_rule_app_service.py`, `tests/api/test_proofreading_app_service.py`
- Create: `tests/model/api/test_quality_rule_models.py`, `tests/model/api/test_prompt_models.py`, `tests/model/api/test_proofreading_models.py`
- Create: `tests/module/data/test_quality_rule_snapshot_service.py`, `tests/module/data/test_quality_rule_mutation_service.py`, `tests/module/data/test_prompt_service.py`, `tests/module/data/test_proofreading_snapshot_service.py`, `tests/module/data/test_proofreading_filter_service.py`, `tests/module/data/test_proofreading_mutation_service.py`, `tests/module/data/test_proofreading_recheck_service.py`

### 修改文件

- Modify: `api/Contract/__init__.py`
- Modify: `api/Application/__init__.py`
- Modify: `api/Server/CoreApiServer.py`
- Modify: `api/Server/Routes/__init__.py`
- Modify: `api/Client/__init__.py`
- Modify: `api/Client/AppClientContext.py`
- Modify: `api/Client/SseClient.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `api/Bridge/EventTopic.py`
- Modify: `api/Bridge/EventBridge.py`
- Modify: `model/Api/__init__.py`
- Modify: `frontend/AppFluentWindow.py`
- Modify: `frontend/Quality/QualityRulePageBase.py`
- Modify: `frontend/Quality/GlossaryPage.py`
- Modify: `frontend/Quality/TextPreservePage.py`
- Modify: `frontend/Quality/TextReplacementPage.py`
- Modify: `frontend/Quality/CustomPromptPage.py`
- Modify: `frontend/Proofreading/FilterDialog.py`
- Modify: `frontend/Proofreading/ProofreadingPage.py`
- Modify: `frontend/Proofreading/ProofreadingLoadService.py`
- Modify: `frontend/Proofreading/ProofreadingDomain.py`
- Modify: `tests/api/test_api_client.py`
- Modify: `tests/api/test_api_layering_boundary.py`
- Modify: `tests/api/test_frontend_core_boundary.py`
- Modify: `api/SPEC.md`

### 参考文件

- Check: `docs/superpowers/specs/2026-03-24-quality-proofreading-separation-design.md`
- Check: `api/Application/ProjectAppService.py`
- Check: `api/Contract/ProjectPayloads.py`
- Check: `frontend/Quality/QualityRulePageBase.py`
- Check: `frontend/Proofreading/ProofreadingPage.py`
- Check: `frontend/Proofreading/ProofreadingLoadService.py`
- Check: `frontend/Proofreading/ProofreadingDomain.py`

### 计划约束

- 实施时遵循 `@test-driven-development` 与 `@verification-before-completion`。
- 每个任务只落一个明确闭环：测试先行、最小实现、验证通过、单独提交。
- 单次 patch 不要把超多文件同时搅在一起，先 Core 纯逻辑，再 API，再 UI。
- `frontend/Quality/**` 与 `frontend/Proofreading/**` 完成迁移后不得再直接导入 `module.Data.DataManager`、`module.Config`、`module.ResultChecker`、`module.QualityRule.*`、`module.Engine.Engine`。

## 1. 里程碑拆分

| 里程碑 | 闭环结果 |
| --- | --- |
| `M1` | `Quality` / `Proofreading` 的对象模型、payload 与边界测试建立 |
| `M2` | `module/Data/Quality/*` 完成规则快照、写操作、预设与提示词服务下沉 |
| `M3` | `module/Data/Proofreading/*` 完成快照、筛选、替换、重检与 revision 服务下沉 |
| `M4` | `api/Application`、`api/Server`、`api/Client` 打通 `Quality` 与 `Proofreading` 协议 |
| `M5` | `frontend/Quality/**` 与 `frontend/Proofreading/**` 改为只消费 API 客户端 |
| `M6` | `api/SPEC.md`、边界测试、最小手动路径与格式检查全部完成 |

## 2. 任务清单

### Task 1: 固定对象模型与前端边界

**Files:**
- Create: `model/Api/QualityRuleModels.py`, `model/Api/PromptModels.py`, `model/Api/ProofreadingModels.py`
- Create: `tests/model/api/test_quality_rule_models.py`, `tests/model/api/test_prompt_models.py`, `tests/model/api/test_proofreading_models.py`
- Modify: `model/Api/__init__.py`, `tests/api/test_frontend_core_boundary.py`

- [ ] **Step 1: 先写失败测试，固定对象字段与第二阶段前端禁用导入**

```python
def test_quality_rule_snapshot_normalizes_entries() -> None:
    snapshot = QualityRuleSnapshot.from_dict(
        {"rule_type": "glossary", "revision": 3, "entries": [{"src": "a", "dst": "b"}]}
    )
    assert snapshot.revision == 3
    assert snapshot.entries[0].src == "a"


def test_phase_two_frontend_files_do_not_import_core_singletons_directly() -> None:
    assert "from module.Data.DataManager import DataManager" not in content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/model/api/test_quality_rule_models.py tests/model/api/test_proofreading_models.py tests/api/test_frontend_core_boundary.py -v`
Expected: FAIL，提示模型文件不存在，且第二阶段边界断言尚未建立。

- [ ] **Step 3: 实现最小对象模型与边界清单**

```python
@dataclass(frozen=True)
class QualityRuleEntry:
    entry_id: str
    src: str
    dst: str = ""
```

要求：

- 只实现 spec 已确认的稳定字段
- 所有模型都提供 `from_dict()`，保持客户端对象化模式一致
- `tests/api/test_frontend_core_boundary.py` 新增 `Quality` / `Proofreading` 文件名单独断言

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/model/api/test_quality_rule_models.py tests/model/api/test_prompt_models.py tests/model/api/test_proofreading_models.py tests/api/test_frontend_core_boundary.py -v`
Expected: PASS，模型可反序列化，边界测试开始覆盖第二阶段页面。

- [ ] **Step 5: 提交**

```bash
git add model/Api tests/model/api tests/api/test_frontend_core_boundary.py
git commit -m "test: add quality proofreading api models"
```

### Task 2: 下沉 `Quality` Core 服务

**Files:**
- Create: `module/Data/Quality/QualityRuleFacadeService.py`, `module/Data/Quality/QualityRuleSnapshotService.py`, `module/Data/Quality/QualityRuleMutationService.py`, `module/Data/Quality/QualityRulePresetService.py`, `module/Data/Quality/PromptService.py`
- Create: `tests/module/data/test_quality_rule_snapshot_service.py`, `tests/module/data/test_quality_rule_mutation_service.py`, `tests/module/data/test_prompt_service.py`
- Modify: `module/Data/Quality/__init__.py`

- [ ] **Step 1: 先写失败测试，固定规则快照与写入口**

```python
def test_glossary_snapshot_contains_meta_and_entries(fake_quality_rule_facade) -> None:
    snapshot = fake_quality_rule_facade.get_rule_snapshot("glossary")
    assert snapshot["meta"]["enabled"] is True
    assert snapshot["entries"][0]["src"] == "勇者"


def test_save_rule_entries_rejects_stale_revision(service) -> None:
    with pytest.raises(QualityRuleRevisionConflictError):
        service.save_entries("glossary", expected_revision=1, entries=[])
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/module/data/test_quality_rule_snapshot_service.py tests/module/data/test_quality_rule_mutation_service.py tests/module/data/test_prompt_service.py -v`
Expected: FAIL，提示服务文件不存在或 revision 语义未实现。

- [ ] **Step 3: 写最小实现，先收口读写与提示词服务**

```python
class QualityRuleSnapshotService:
    def get_rule_snapshot(self, rule_type: str) -> dict[str, object]:
        return {"rule_type": rule_type, "revision": 0, "meta": {}, "entries": []}
```

要求：

- `QualityRuleMutationService` 负责保存、删除、排序、布尔字段切换与 meta 更新
- `PromptService` 负责提示词快照、保存、导入导出、预设
- 现阶段先允许服务内部继续调用 `DataManager` / `Config`，但 UI 不得再直接碰它们

- [ ] **Step 4: 运行最小模块测试确认通过**

Run: `uv run pytest tests/module/data/test_quality_rule_snapshot_service.py tests/module/data/test_quality_rule_mutation_service.py tests/module/data/test_prompt_service.py -v`
Expected: PASS，确认规则快照、写操作与提示词服务已在 Core 落地。

- [ ] **Step 5: 提交**

```bash
git add module/Data/Quality tests/module/data
git commit -m "feat: add quality rule core services"
```

### Task 3: 下沉 `Proofreading` Core 服务

**Files:**
- Create: `module/Data/Proofreading/ProofreadingSnapshotService.py`, `module/Data/Proofreading/ProofreadingFilterService.py`, `module/Data/Proofreading/ProofreadingMutationService.py`, `module/Data/Proofreading/ProofreadingRecheckService.py`, `module/Data/Proofreading/ProofreadingRevisionService.py`
- Create: `tests/module/data/test_proofreading_snapshot_service.py`, `tests/module/data/test_proofreading_filter_service.py`, `tests/module/data/test_proofreading_mutation_service.py`, `tests/module/data/test_proofreading_recheck_service.py`
- Modify: `frontend/Proofreading/ProofreadingLoadService.py`, `frontend/Proofreading/ProofreadingDomain.py`
- Modify: `tests/api/test_frontend_core_boundary.py`

**终态要求：**

- `frontend/Proofreading/ProofreadingLoadService.py` 与 `frontend/Proofreading/ProofreadingDomain.py` 在 Task 3 完成后只允许保留为无 Core 依赖的薄包装或纯数据转换层，不得再直接导入 `Config`、`DataManager`、`ResultChecker`
- 若 Task 3 后 `ProofreadingPage` 仍临时通过这两个文件取数，只允许它们转调 `module/Data/Proofreading/*`；不得继续承载业务判定、revision、筛选或重检主逻辑
- 到 Task 7 完成时，`ProofreadingPage.py` 与 `FilterDialog.py` 必须停止依赖这两个 helper；若文件仍保留，也只能作为兼容薄层存在
- `tests/api/test_frontend_core_boundary.py` 必须新增针对这两个文件的专门断言，防止“逻辑搬走了但旧 Core 入口还活着”

- [ ] **Step 1: 先写失败测试，固定快照、筛选与 mutation 语义**

```python
def test_snapshot_service_builds_warning_summary(project_session) -> None:
    snapshot = ProofreadingSnapshotService().build_snapshot("current")
    assert snapshot["summary"]["total_items"] >= 0


def test_replace_all_returns_changed_item_ids(service) -> None:
    result = service.replace_all(expected_revision=2, search_text="a", replace_text="b")
    assert result["changed_item_ids"] == [1]


def test_proofreading_helper_files_do_not_import_core_singletons_directly() -> None:
    assert "from module.Config import Config" not in content
    assert "from module.Data.DataManager import DataManager" not in content
    assert "from module.ResultChecker import ResultChecker" not in content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/module/data/test_proofreading_snapshot_service.py tests/module/data/test_proofreading_filter_service.py tests/module/data/test_proofreading_mutation_service.py tests/module/data/test_proofreading_recheck_service.py tests/api/test_frontend_core_boundary.py -v`
Expected: FAIL，提示服务文件不存在，或旧逻辑仍停留在前端文件，且前端 helper 仍直接依赖旧 Core 导入。

- [ ] **Step 3: 写最小实现，先迁纯逻辑后补 revision**

```python
class ProofreadingRevisionService:
    def assert_revision(self, expected_revision: int, current_revision: int) -> None:
        if expected_revision != current_revision:
            raise ProofreadingRevisionConflictError(expected_revision, current_revision)
```

要求：

- 先把 `ProofreadingLoadService`、`ProofreadingDomain` 中不依赖 Qt 的逻辑迁过去
- `ProofreadingMutationService` 统一保存、单次替换、批量替换、批量保存
- `ProofreadingRecheckService` 统一 `ResultChecker` 调用与 failed glossary term 重建
- `frontend/Proofreading/ProofreadingLoadService.py` 与 `frontend/Proofreading/ProofreadingDomain.py` 若暂不删除，必须收缩为只调用 `module/Data/Proofreading/*` 或只保留纯数据转换，禁止继续直接触碰 `Config`、`DataManager`、`ResultChecker`
- `tests/api/test_frontend_core_boundary.py` 需要对这两个文件单独断言，避免旧 helper 作为隐藏回退入口长期存在

- [ ] **Step 4: 运行模块测试确认通过**

Run: `uv run pytest tests/module/data/test_proofreading_snapshot_service.py tests/module/data/test_proofreading_filter_service.py tests/module/data/test_proofreading_mutation_service.py tests/module/data/test_proofreading_recheck_service.py tests/api/test_frontend_core_boundary.py -v`
Expected: PASS，校对快照、筛选、替换、重检与 revision 行为稳定，且旧前端 helper 已失去直接触碰 Core 的能力。

- [ ] **Step 5: 提交**

```bash
git add module/Data/Proofreading frontend/Proofreading/ProofreadingLoadService.py frontend/Proofreading/ProofreadingDomain.py tests/module/data tests/api/test_frontend_core_boundary.py
git commit -m "feat: add proofreading core services"
```

### Task 4: 打通 `Quality` API 协议

**Files:**
- Create: `api/Contract/QualityPayloads.py`, `api/Contract/PromptPayloads.py`, `api/Application/QualityRuleAppService.py`, `api/Server/Routes/QualityRoutes.py`, `api/Client/QualityRuleApiClient.py`, `tests/api/test_quality_rule_app_service.py`
- Modify: `api/Contract/__init__.py`, `api/Application/__init__.py`, `api/Server/CoreApiServer.py`, `api/Server/Routes/__init__.py`, `api/Client/__init__.py`, `tests/api/test_api_client.py`

- [ ] **Step 1: 先写失败测试，固定 `Quality` 快照与命令接口**

```python
def test_get_quality_rule_snapshot_returns_payload(app_service) -> None:
    result = app_service.get_rule_snapshot({"rule_type": "glossary"})
    assert result["snapshot"]["rule_type"] == "glossary"


def test_quality_api_client_returns_object(api_server_base_url) -> None:
    client = QualityRuleApiClient(ApiClient(api_server_base_url))
    snapshot = client.get_rule_snapshot("glossary")
    assert snapshot.rule_type == "glossary"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_quality_rule_app_service.py tests/api/test_api_client.py -v`
Expected: FAIL，提示新 app service、route 或 client 不存在。

- [ ] **Step 3: 写最小实现并接入服务端路由**

```python
class QualityRuleAppService:
    def get_rule_snapshot(self, request: dict[str, object]) -> dict[str, object]:
        return {"snapshot": self.quality_rule_facade.get_rule_snapshot(str(request["rule_type"]))}
```

要求：

- 所有响应都通过 `*Payload.to_dict()` 统一序列化
- `QualityRuleApiClient` 只返回对象，不返回原始 `dict`
- 先覆盖 `snapshot`、`update-meta`、`save-entries`、`query-proofreading`

- [ ] **Step 4: 运行 API 测试确认通过**

Run: `uv run pytest tests/api/test_quality_rule_app_service.py tests/api/test_api_client.py -v`
Expected: PASS，`Quality` API 已可完成最小闭环。

- [ ] **Step 5: 提交**

```bash
git add api/Contract api/Application api/Server api/Client tests/api
git commit -m "feat: add quality rule api layer"
```

### Task 5: 打通 `Proofreading` API 协议与 SSE 主题

**Files:**
- Create: `api/Contract/ProofreadingPayloads.py`, `api/Application/ProofreadingAppService.py`, `api/Server/Routes/ProofreadingRoutes.py`, `api/Client/ProofreadingApiClient.py`, `tests/api/test_proofreading_app_service.py`
- Modify: `api/Bridge/EventTopic.py`, `api/Bridge/EventBridge.py`, `api/Client/SseClient.py`, `api/Client/ApiStateStore.py`, `api/Server/CoreApiServer.py`, `tests/api/test_api_client.py`

- [ ] **Step 1: 先写失败测试，固定快照、mutation 与 SSE topic**

```python
def test_proofreading_snapshot_returns_revision(app_service) -> None:
    result = app_service.get_snapshot({})
    assert result["snapshot"]["revision"] >= 0


def test_quality_rule_update_maps_to_snapshot_invalidated_topic(event_bridge) -> None:
    topic, payload = event_bridge.map_event(Base.Event.QUALITY_RULE_UPDATE, {"rule_type": "glossary"})
    assert topic == "proofreading.snapshot_invalidated"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_proofreading_app_service.py tests/api/test_event_bridge.py tests/api/test_api_client.py -v`
Expected: FAIL，提示 proofreading app service、route、client 或 SSE topic 尚未接入。

- [ ] **Step 3: 写最小实现并串起 revision 冲突**

```python
class ProofreadingAppService:
    def replace_all(self, request: dict[str, object]) -> dict[str, object]:
        return {"result": self.proofreading_mutation_service.replace_all(**request)}
```

要求：

- 先覆盖 `snapshot`、`filter`、`search`、`save-item`、`replace-all`、`recheck-item`
- `ApiStateStore` 只缓存需要跨页共享的最小状态；页面细粒度结果由命令响应直接消费
- `SseClient` 只新增失效通知与长操作进度处理，不做整页流式合并

- [ ] **Step 4: 运行 API 与事件测试确认通过**

Run: `uv run pytest tests/api/test_proofreading_app_service.py tests/api/test_event_bridge.py tests/api/test_api_client.py -v`
Expected: PASS，`Proofreading` API 与新 topic 已形成最小协议闭环。

- [ ] **Step 5: 提交**

```bash
git add api/Contract api/Application api/Bridge api/Client api/Server tests/api
git commit -m "feat: add proofreading api layer"
```

### Task 6: 迁移 `Quality` 页面为 API consumer

**Files:**
- Modify: `api/Client/AppClientContext.py`, `frontend/AppFluentWindow.py`
- Modify: `frontend/Quality/QualityRulePageBase.py`, `frontend/Quality/GlossaryPage.py`, `frontend/Quality/TextPreservePage.py`, `frontend/Quality/TextReplacementPage.py`, `frontend/Quality/CustomPromptPage.py`
- Modify: `tests/api/test_api_layering_boundary.py`, `tests/api/test_frontend_core_boundary.py`

- [ ] **Step 1: 先写失败测试，固定 `Quality` 页面不再直连 Core**

```python
def test_quality_pages_use_quality_rule_api_client() -> None:
    assert "from module.Data.DataManager import DataManager" not in glossary_content
    assert "quality_rule_api_client" in window_content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `Quality` 页面仍然依赖旧导入或未接入 `AppClientContext`。

- [ ] **Step 3: 写最小 UI 迁移实现**

```python
self.quality_rule_api_client = app_client_context.quality_rule_api_client
self.proofreading_api_client = app_client_context.proofreading_api_client
```

要求：

- `AppFluentWindow` 统一持有新客户端并向相关页面暴露
- `QualityRulePageBase` 改为通过客户端拉快照、提交保存、导入导出与统计
- `GlossaryPage`、`TextPreservePage`、`TextReplacementPage` 只保留列定义、表单绑定与页面文案
- `CustomPromptPage` 的提示词导入导出、预设、保存都改为走 `QualityRuleApiClient`

- [ ] **Step 4: 运行页面边界与 API 客户端测试确认通过**

Run: `uv run pytest tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py tests/api/test_api_client.py -v`
Expected: PASS，`Quality` 页不再直连 Core，客户端行为正常。

- [ ] **Step 5: 提交**

```bash
git add api/Client/AppClientContext.py frontend/AppFluentWindow.py frontend/Quality tests/api
git commit -m "refactor: migrate quality pages to api clients"
```

### Task 7: 迁移 `Proofreading` 页面为 API consumer

**Files:**
- Modify: `frontend/Proofreading/FilterDialog.py`, `frontend/Proofreading/ProofreadingPage.py`
- Modify: `tests/api/test_api_layering_boundary.py`, `tests/api/test_frontend_core_boundary.py`

- [ ] **Step 1: 先写失败测试，固定 `ProofreadingPage` 只消费 API 结果**

```python
def test_proofreading_page_does_not_import_result_checker_or_data_manager() -> None:
    assert "from module.ResultChecker import ResultChecker" not in content
    assert "from module.Data.DataManager import DataManager" not in content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py -v`
Expected: FAIL，提示 `ProofreadingPage` 仍保留旧 Core 依赖。

- [ ] **Step 3: 写最小 UI 迁移实现**

```python
snapshot = self.proofreading_api_client.get_snapshot()
result = self.proofreading_api_client.replace_all(request)
```

要求：

- `ProofreadingPage` 只保存当前展示所需的对象快照、当前选中项 id、搜索输入与局部 UI 状态
- `FilterDialog` 改为消费 `ProofreadingFilterOptionsSnapshot`
- 删除页面内对 `ResultChecker`、`warning_map`、`failed_terms_by_item_key` 的直接维护
- 收到 `proofreading.snapshot_invalidated` 时重新拉快照并尽量恢复选中项

- [ ] **Step 4: 运行边界与功能测试确认通过**

Run: `uv run pytest tests/api/test_api_layering_boundary.py tests/api/test_frontend_core_boundary.py tests/api/test_proofreading_app_service.py tests/api/test_api_client.py -v`
Expected: PASS，校对页只通过 API 客户端工作。

- [ ] **Step 5: 提交**

```bash
git add frontend/Proofreading tests/api
git commit -m "refactor: migrate proofreading page to api client"
```

### Task 8: 同步文档、契约并完成验证闭环

**Files:**
- Modify: `api/SPEC.md`
- Modify: `tests/api/test_frontend_core_boundary.py`
- Modify: `tests/api/test_api_layering_boundary.py`

- [ ] **Step 1: 先补失败测试，固定 SPEC 与第二阶段边界声明**

```python
def test_api_spec_mentions_quality_and_proofreading_routes() -> None:
    assert "/api/quality/rules/snapshot" in spec_content
    assert "/api/proofreading/snapshot" in spec_content
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_api_layering_boundary.py -v`
Expected: FAIL，提示 `api/SPEC.md` 尚未纳入新接口与 topic。

- [ ] **Step 3: 更新契约文档并做完整验证**

要求：

- 在 `api/SPEC.md` 中补齐 `Quality` / `Proofreading` 路由、payload、错误码与 SSE topic
- 保持已有第一阶段接口说明不回退
- 若边界测试存在重复断言，合并为单一来源，避免同一规则在多处漂移

- [ ] **Step 4: 运行完整验证**

Run: `uv run pytest tests/model/api tests/module/data tests/api -v`
Expected: PASS，所有模型、模块与 API 测试通过。

Run: `uv run pytest tests/base/test_cli_manager.py -v`
Expected: PASS，CLI 路径未被第二阶段改造误伤。

Run: `uv run ruff format api model frontend module tests`
Expected: PASS。

Run: `uv run ruff check --fix api model frontend module tests`
Expected: PASS。

Run: `rg -n "from module\\.Data\\.DataManager import DataManager|from module\\.Config import Config|from module\\.ResultChecker import ResultChecker|from module\\.Engine\\.Engine import Engine" frontend/Quality frontend/Proofreading -S`
Expected: 无结果。

- [ ] **Step 5: 提交**

```bash
git add api/SPEC.md tests/api
git commit -m "docs: finalize quality proofreading api contract"
```

## 3. 执行提示

- 若在执行时发现 `Quality` 与 `Proofreading` 的 UI 迁移互相阻塞，优先保证 Core 服务、API 与客户端测试先绿，再做页面切换。
- 若 `ProofreadingPage.py` 体积过大导致一次修改风险过高，可以在不改变行为前提下，先把 API 适配逻辑抽到同目录辅助类，再进入最终边界替换。
- 若 `CustomPromptPage.py` 的提示词预设逻辑与 `PromptPathResolver` 强耦合，先以 `PromptService` 为薄适配层收口，不额外引入新的兼容层。
