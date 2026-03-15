# AnalysisService 重构实施计划

> **执行状态（2026-03-16）:** 计划中的核心拆分已经落地：
> `AnalysisTextPolicy`、`AnalysisCandidateService`、`AnalysisProgressService`、
> `AnalysisRepository`、`TranslationResetService`、
> `AnalysisGlossaryImportService` 已创建并接线；
> `term_pool` 旧接口与旧 meta 键已从运行时代码中移除；
> 代码已通过 `ruff` 与完整 `pytest` 验证。

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有分析提交流程的前提下，按职责拆分 `AnalysisService`，移除 `term_pool` 旧命名负担，并把放错层的逻辑迁回更合适的业务模块。

**Architecture:** 保留 `DataManager -> AnalysisService` 这一层对外门面，先用测试锁住现有行为，再把文本口径、候选聚合、进度/检查点、翻译失败重置拆到更小的部件。数据层继续负责分析表读写与事务一致性，规则判断与翻译重置分别迁往规则域和翻译域，最后统一删除 `term_pool` 旧别名与旧 meta 键。

**Tech Stack:** Python 3.14, `uv`, `pytest`, `ruff`, PySide6, PySide6-Fluent-Widgets

---

## 文件结构

### 计划中的新文件
- `module/Engine/Analyzer/AnalysisTextPolicy.py`
  - 统一分析输入文本、哈希、控制码特殊规则，避免数据层反向依赖分析引擎细节。
- `module/Data/Analysis/AnalysisCandidateService.py`
  - 负责候选 observation 合并、aggregate 票数处理、候选转术语条目。
- `module/Data/Analysis/AnalysisProgressService.py`
  - 负责待分析条目筛选、覆盖率统计、进度快照拼装、失败 checkpoint 规整。
- `module/Data/Analysis/AnalysisRepository.py`
  - 负责分析专用表与 meta 的读写编排，承接 `AnalysisService` 中直接碰 DB 的细节。
- `module/Data/Translation/TranslationResetService.py`
  - 负责“重置失败翻译条目”这条翻译域逻辑。
- `module/QualityRule/AnalysisGlossaryImportService.py`
  - 负责分析候选导入术语表前的预演与过滤。

### 计划中的修改文件
- `module/Data/Analysis/AnalysisService.py`
- `module/Data/DataManager.py`
- `module/Engine/Analyzer/AnalysisPipeline.py`
- `module/Engine/Analyzer/Analyzer.py`
- `module/Engine/Translator/Translator.py`
- `base/CLIManager.py`
- `module/Data/Project/ProjectPrefilterService.py`
- `module/Data/spec.md`
- `tests/module/data/test_analysis_service.py`
- `tests/module/data/test_project_prefilter_service.py`
- `tests/module/engine/analyzer/test_analyzer.py`
- `tests/module/engine/analyzer/conftest.py`
- `tests/module/engine/translator/test_translator.py`

### 约束和落地规则
- 外部模块继续只依赖 `DataManager`，不要让 UI、Engine 直接 import 新的数据层内部 service。
- 分析表写入事务仍然收口在数据层，避免拆分后把 SQL 或事务边界漏到其他层。
- 先引入新名字，再删除旧名字；`term_pool` 的移除要以测试和调用点清零为准，不要边做边猜。
- 所有新增和修改的函数都补类型标注与“为什么”的注释。

## Chunk 1: 先锁行为，再收术语命名

### Task 1: 用测试冻结现状，避免拆分时行为漂移

**Files:**
- Modify: `tests/module/data/test_analysis_service.py`
- Modify: `tests/module/engine/analyzer/test_analyzer.py`
- Modify: `tests/module/engine/analyzer/conftest.py`
- Modify: `tests/module/engine/translator/test_translator.py`

- [ ] **Step 1: 先补 3 组失败测试，锁住重构前后的关键行为**

```python
def test_import_analysis_candidates_uses_candidate_path() -> None:
    service, _session = build_analysis_service()
    service.build_analysis_glossary_from_candidates = MagicMock(return_value=[])
    assert service.import_analysis_candidates() == 0


def test_term_pool_alias_only_for_compatibility() -> None:
    service, _session = build_analysis_service()
    service.get_analysis_candidate_aggregate = MagicMock(return_value={"HP": {}})
    assert service.get_analysis_term_pool() == {"HP": {}}


def test_reset_failed_translation_items_updates_translation_snapshot() -> None:
    dm = FakeDataManager()
    result = dm.reset_failed_items_sync()
    assert result is None or "line" in result
```

- [ ] **Step 2: 运行最小测试集，确认新增断言现在至少有一部分会失败**

```bash
uv run pytest tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py tests/module/engine/translator/test_translator.py -v
```

Expected: 至少有和新命名、迁移目标相关的断言失败，说明测试真正卡住了后续改动。

- [ ] **Step 3: 把测试夹具中的假实现补成“双命名并存”的过渡形态**

```python
def import_analysis_candidates(
    self, expected_lg_path: str | None = None
) -> int | None:
    return self.import_analysis_term_pool(expected_lg_path)
```

- [ ] **Step 4: 再跑一次最小测试集，确认测试夹具口径和目标设计一致**

```bash
uv run pytest tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py tests/module/engine/translator/test_translator.py -v
```

Expected: 仍可能失败，但失败点应该只剩真实实现没跟上的部分，而不是夹具缺口。

- [ ] **Step 5: 提交一次“安全网”小提交**

```bash
git add tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py tests/module/engine/analyzer/conftest.py tests/module/engine/translator/test_translator.py
git commit -m "test: freeze analysis refactor behavior"
```

### Task 2: 先把 `term_pool` 旧名字降级成兼容壳

**Files:**
- Modify: `module/Data/Analysis/AnalysisService.py`
- Modify: `module/Data/DataManager.py`
- Modify: `module/Engine/Analyzer/Analyzer.py`
- Modify: `tests/module/data/test_analysis_service.py`
- Modify: `tests/module/engine/analyzer/test_analyzer.py`

- [ ] **Step 1: 先写失败测试，要求新名字成为主入口**

```python
def test_analyzer_import_analysis_candidates_sync_calls_new_entry(
    monkeypatch: pytest.MonkeyPatch,
    fake_data_manager,
) -> None:
    analyzer = Analyzer()
    called: list[str] = []

    def fake_import(expected_lg_path: str) -> int:
        called.append(expected_lg_path)
        return 1

    fake_data_manager.import_analysis_candidates = fake_import
    assert analyzer.import_analysis_candidates_sync(fake_data_manager, expected_lg_path="demo.lg") == 1
    assert called == ["demo.lg"]
```

- [ ] **Step 2: 跑目标测试，确认因为新方法不存在或旧调用未改而失败**

```bash
uv run pytest tests/module/engine/analyzer/test_analyzer.py -k "import_analysis_candidates_sync or term_pool" -v
```

Expected: FAIL，提示 `import_analysis_candidates_sync` 缺失或仍调用旧名字。

- [ ] **Step 3: 实现最小改动，让 `candidates` 成为主命名，`term_pool` 只保留薄别名**

```python
def import_analysis_candidates_sync(
    self,
    dm: DataManager,
    *,
    expected_lg_path: str,
) -> int | None:
    return dm.import_analysis_candidates(expected_lg_path=expected_lg_path)


def import_analysis_term_pool_sync(
    self,
    dm: DataManager,
    *,
    expected_lg_path: str,
) -> int | None:
    return self.import_analysis_candidates_sync(
        dm,
        expected_lg_path=expected_lg_path,
    )
```

- [ ] **Step 4: 运行分析导入相关测试，确认新旧命名都指向同一条实现**

```bash
uv run pytest tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py -k "import_analysis_candidates or term_pool" -v
```

Expected: PASS，或者只剩后续模块拆分尚未完成导致的失败。

- [ ] **Step 5: 提交一次“命名统一”小提交**

```bash
git add module/Data/Analysis/AnalysisService.py module/Data/DataManager.py module/Engine/Analyzer/Analyzer.py tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py
git commit -m "refactor: prefer analysis candidates naming"
```

## Chunk 2: 把住错房间的逻辑搬回去

### Task 3: 抽出分析文本口径规则，切断数据层对分析引擎细节的反向依赖

**Files:**
- Create: `module/Engine/Analyzer/AnalysisTextPolicy.py`
- Modify: `module/Data/Analysis/AnalysisService.py`
- Modify: `module/Data/DataManager.py`
- Modify: `module/Engine/Analyzer/AnalysisPipeline.py`
- Test: `tests/module/data/test_analysis_service.py`

- [ ] **Step 1: 先写失败测试，锁住源文本、哈希、控制码自映射的统一口径**

```python
def test_analysis_text_policy_builds_source_text_and_hash() -> None:
    item = Item(src="hello", name_src=["Alice", "Alice", ""])
    text = AnalysisTextPolicy.build_source_text(item)
    assert text == "Alice\nhello"
    assert AnalysisTextPolicy.build_source_hash(text) != ""
```

- [ ] **Step 2: 跑单测，确认新模块还不存在**

```bash
uv run pytest tests/module/data/test_analysis_service.py -k "text_policy or source_text" -v
```

Expected: FAIL，提示 `AnalysisTextPolicy` 不存在。

- [ ] **Step 3: 新建 `AnalysisTextPolicy.py`，并让 `AnalysisService`、`DataManager`、`AnalysisPipeline` 全部改为调这个统一入口**

```python
class AnalysisTextPolicy:
    """统一分析文本口径，避免数据层和引擎层各写一套规则。"""

    @staticmethod
    def build_source_text(item: Item) -> str:
        ...

    @staticmethod
    def build_source_hash(source_text: str) -> str:
        ...
```

- [ ] **Step 4: 跑关联测试，确认三个入口口径一致**

```bash
uv run pytest tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py -k "source_text or control_code or hash" -v
```

Expected: PASS。

- [ ] **Step 5: 提交一次“口径规则抽离”小提交**

```bash
git add module/Engine/Analyzer/AnalysisTextPolicy.py module/Data/Analysis/AnalysisService.py module/Data/DataManager.py module/Engine/Analyzer/AnalysisPipeline.py tests/module/data/test_analysis_service.py
git commit -m "refactor: extract analysis text policy"
```

### Task 4: 把翻译失败重置迁到翻译域

**Files:**
- Create: `module/Data/Translation/TranslationResetService.py`
- Modify: `module/Data/DataManager.py`
- Modify: `module/Engine/Translator/Translator.py`
- Modify: `base/CLIManager.py`
- Modify: `module/Data/Analysis/AnalysisService.py`
- Modify: `tests/module/engine/translator/test_translator.py`

- [ ] **Step 1: 先写失败测试，要求失败重置逻辑从翻译域服务提供**

```python
def test_translation_reset_failed_sync_uses_translation_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = DataManager.get()
    monkeypatch.setattr(dm, "reset_failed_translation_items_sync", lambda: {"line": 22})
    assert dm.reset_failed_translation_items_sync()["line"] == 22
```

- [ ] **Step 2: 跑翻译重置测试，确认新服务和新名字都还没落地**

```bash
uv run pytest tests/module/engine/translator/test_translator.py -k "reset_failed" -v
```

Expected: FAIL，提示新方法不存在或调用点仍指向 `AnalysisService`。

- [ ] **Step 3: 新建 `TranslationResetService`，让 `DataManager` 注入它，并把 `Translator` / `CLIManager` 改用新入口**

```python
class TranslationResetService:
    """只负责翻译失败条目的重置，不承担分析候选逻辑。"""

    def reset_failed_translation_items_sync(self) -> dict[str, Any] | None:
        ...
```

- [ ] **Step 4: 跑翻译相关测试，确认行为不变、归属变对**

```bash
uv run pytest tests/module/engine/translator/test_translator.py -v
```

Expected: PASS。

- [ ] **Step 5: 提交一次“逻辑归位”小提交**

```bash
git add module/Data/Translation/TranslationResetService.py module/Data/DataManager.py module/Engine/Translator/Translator.py base/CLIManager.py module/Data/Analysis/AnalysisService.py tests/module/engine/translator/test_translator.py
git commit -m "refactor: move failed translation reset to translation service"
```

### Task 5: 把候选导入预演和过滤搬到规则域业务服务

**Files:**
- Create: `module/QualityRule/AnalysisGlossaryImportService.py`
- Modify: `module/Data/Analysis/AnalysisService.py`
- Modify: `module/Data/DataManager.py`
- Modify: `tests/module/data/test_analysis_service.py`

- [ ] **Step 1: 先补失败测试，锁住“预演 + 过滤 + 合并”的结果口径**

```python
def test_analysis_glossary_import_service_filters_low_value_candidates() -> None:
    service, _session = build_analysis_service()
    preview = service.build_analysis_glossary_import_preview(
        [{"src": "Alice", "dst": "爱丽丝", "info": "女性人名"}]
    )
    filtered = service.filter_analysis_glossary_import_candidates(
        [{"src": "Alice", "dst": "爱丽丝", "info": "女性人名"}],
        preview,
    )
    assert isinstance(filtered, list)
```

- [ ] **Step 2: 跑分析导入相关测试，确认新服务抽离前测试可见失败**

```bash
uv run pytest tests/module/data/test_analysis_service.py -k "glossary_import or import_candidates" -v
```

Expected: FAIL，提示新服务尚未接线或旧实现仍被强耦合。

- [ ] **Step 3: 新建 `AnalysisGlossaryImportService`，把预演与过滤逻辑搬过去，`AnalysisService` 只保留调用编排**

```python
class AnalysisGlossaryImportService:
    """负责把分析候选转成可导入术语的业务决策。"""

    def build_preview(
        self,
        glossary_entries: list[dict[str, Any]],
    ) -> AnalysisGlossaryImportPreview:
        ...
```

- [ ] **Step 4: 跑数据层测试，确认规则域抽离后导入结果不变**

```bash
uv run pytest tests/module/data/test_analysis_service.py -v
```

Expected: PASS。

- [ ] **Step 5: 提交一次“导入规则拆分”小提交**

```bash
git add module/QualityRule/AnalysisGlossaryImportService.py module/Data/Analysis/AnalysisService.py module/Data/DataManager.py tests/module/data/test_analysis_service.py
git commit -m "refactor: extract analysis glossary import service"
```

## Chunk 3: 把数据层拆细，再清理旧入口

### Task 6: 提取 Analysis 内部部件，压薄 `AnalysisService`

**Files:**
- Create: `module/Data/Analysis/AnalysisCandidateService.py`
- Create: `module/Data/Analysis/AnalysisProgressService.py`
- Create: `module/Data/Analysis/AnalysisRepository.py`
- Modify: `module/Data/Analysis/AnalysisService.py`
- Modify: `module/Data/DataManager.py`
- Test: `tests/module/data/test_analysis_service.py`

- [ ] **Step 1: 先补失败测试，要求 `AnalysisService` 仍能保持原有公开行为**

```python
def test_commit_analysis_task_result_writes_checkpoints_and_aggregate() -> None:
    service, session = build_analysis_service()
    inserted = service.commit_analysis_task_result(
        task_fingerprint="task-1",
        checkpoints=[{"item_id": 1, "source_hash": "hash-1", "status": Base.ProjectStatus.PROCESSED}],
        glossary_entries=[{"src": "Alice", "dst": "爱丽丝", "info": "女性人名"}],
    )
    assert inserted == 1
    session.db.upsert_analysis_candidate_aggregates.assert_called_once()
```

- [ ] **Step 2: 运行数据层测试，确认重构前的基线仍被锁住**

```bash
uv run pytest tests/module/data/test_analysis_service.py -v
```

Expected: 现有实现 PASS；后续每次拆分都回跑这组测试。

- [ ] **Step 3: 按职责拆出 3 个内部 service，再让 `AnalysisService` 只保留门面与事务编排**

```python
class AnalysisRepository:
    """承接分析专用表读写和事务内 meta 同步。"""


class AnalysisCandidateService:
    """承接 observation 去重、aggregate 合并、候选转术语。"""


class AnalysisProgressService:
    """承接待分析项筛选、状态汇总和失败 checkpoint 规整。"""
```

- [ ] **Step 4: 每拆完一块就回跑一次数据层测试，最后再跑分析引擎相关测试**

```bash
uv run pytest tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py -v
```

Expected: PASS。

- [ ] **Step 5: 提交一次“数据层拆细”小提交**

```bash
git add module/Data/Analysis/AnalysisCandidateService.py module/Data/Analysis/AnalysisProgressService.py module/Data/Analysis/AnalysisRepository.py module/Data/Analysis/AnalysisService.py module/Data/DataManager.py tests/module/data/test_analysis_service.py
git commit -m "refactor: split analysis service internals"
```

### Task 7: 删除 `term_pool` 旧接口和旧 meta 键

**Files:**
- Modify: `module/Data/Analysis/AnalysisService.py`
- Modify: `module/Data/DataManager.py`
- Modify: `module/Engine/Analyzer/Analyzer.py`
- Modify: `module/Data/Project/ProjectPrefilterService.py`
- Modify: `tests/module/data/test_analysis_service.py`
- Modify: `tests/module/engine/analyzer/test_analyzer.py`

- [ ] **Step 1: 先写失败测试，要求代码库不再依赖 `term_pool` 旧入口**

```python
def test_project_prefilter_resets_analysis_candidates_without_legacy_meta() -> None:
    result = run_prefilter_once(...)
    assert "analysis_term_pool" not in result.meta
```

- [ ] **Step 2: 运行聚焦测试，确认旧字段仍然存在，因此测试应失败**

```bash
uv run pytest tests/module/data/test_project_prefilter_service.py tests/module/engine/analyzer/test_analyzer.py -k "term_pool or prefilter" -v
```

Expected: FAIL，提示 `analysis_term_pool` 仍在 meta 或旧方法仍被调用。

- [ ] **Step 3: 删除旧入口和旧字段，把所有内部调用统一切到 `candidate(s)` 命名**

```python
meta = {
    "prefilter_config": result.prefilter_config,
    "source_language": request.source_language,
    "target_language": request.target_language,
    "analysis_extras": {},
    "analysis_state": {},
}
```

- [ ] **Step 4: 跑旧命名相关测试，确认调用点与 meta 键都已清零**

```bash
uv run pytest tests/module/data/test_project_prefilter_service.py tests/module/engine/analyzer/test_analyzer.py tests/module/data/test_analysis_service.py -v
```

Expected: PASS。

- [ ] **Step 5: 提交一次“删除兼容壳”小提交**

```bash
git add module/Data/Analysis/AnalysisService.py module/Data/DataManager.py module/Engine/Analyzer/Analyzer.py module/Data/Project/ProjectPrefilterService.py tests/module/data/test_analysis_service.py tests/module/engine/analyzer/test_analyzer.py
git commit -m "refactor: remove legacy analysis term pool aliases"
```

### Task 8: 更新文档、格式化并做完整验证

**Files:**
- Modify: `module/Data/spec.md`
- Modify: `docs/superpowers/plans/2026-03-16-analysis-service-refactor.md`

- [ ] **Step 1: 更新 `module/Data/spec.md`，把新的 Analysis 内部结构和职责边界写清楚**

```text
Analysis/
  AnalysisService.py          # 对外门面
  AnalysisRepository.py       # 分析表读写
  AnalysisCandidateService.py # 候选聚合与术语转换
  AnalysisProgressService.py  # 进度与 checkpoint 口径
```

- [ ] **Step 2: 运行格式化和静态检查，只针对改动文件执行**

```bash
uv run ruff format module/Data/Analysis module/Data/DataManager.py module/Engine/Analyzer/AnalysisPipeline.py module/Engine/Analyzer/Analyzer.py module/Engine/Translator/Translator.py base/CLIManager.py module/Data/Project/ProjectPrefilterService.py module/Data/spec.md tests/module/data/test_analysis_service.py tests/module/data/test_project_prefilter_service.py tests/module/engine/analyzer/test_analyzer.py tests/module/engine/translator/test_translator.py
uv run ruff check --fix module/Data/Analysis module/Data/DataManager.py module/Engine/Analyzer/AnalysisPipeline.py module/Engine/Analyzer/Analyzer.py module/Engine/Translator/Translator.py base/CLIManager.py module/Data/Project/ProjectPrefilterService.py tests/module/data/test_analysis_service.py tests/module/data/test_project_prefilter_service.py tests/module/engine/analyzer/test_analyzer.py tests/module/engine/translator/test_translator.py
```

Expected: PASS。

- [ ] **Step 3: 运行完整自动化测试，确认拆分后没有跨模块回归**

```bash
uv run pytest
```

Expected: PASS。

- [ ] **Step 4: 做 3 条最小手工验证路径，确保 UI 和流程没有被拆坏**

```text
1. 打开已有工程 -> 分析页启动分析 -> 分析完成后导入术语 -> 确认成功提示与术语刷新正常
2. 翻译页执行“重置失败项” -> 确认只影响翻译状态，不影响分析候选池
3. 工作台更新或删除文件 -> 确认分析进度、checkpoint、候选池都被清空并能重新分析
```

- [ ] **Step 5: 提交最终整理提交**

```bash
git add module/Data/spec.md docs/superpowers/plans/2026-03-16-analysis-service-refactor.md
git commit -m "docs: update analysis refactor plan and module spec"
```

## 备注

- 这个计划默认当前环境没有可用的子代理派发工具；如果后续执行环境支持 subagent，优先按文档头部要求切到 `superpowers:subagent-driven-development`。
- 如果在 Task 6 拆分时发现 `AnalysisService` 之外还有大量重复的 checkpoint 口径代码，优先复用 `AnalysisProgressService`，不要在 `AnalysisPipeline` 和数据层继续各自维护一套。
- 如果执行中发现 `term_pool` 旧方法仍被外部第三方脚本依赖，不要悄悄保留半套兼容；先补说明，再决定是否增加一轮显式 deprecate 过渡。
