# V2 项目运行态协议实施计划

> **给代理执行者：** 必需子技能：使用 `$subagent-driven-development`（推荐）或 `$executing-plans` 按任务逐项执行。步骤使用 checkbox (`- [ ]`) 语法跟踪。

**Goal:** 交付 V2 项目运行态协议、统一 `ProjectStore`、Worker 多核计算运行时，以及工作台/校对页/规则页的主路径迁移；所有新协议边界统一落在 `/api/v2/...` 与带 `V2` / `v2` 标识的文件路径下，并在完成后可以直接删除这些路径之外的旧运行态协议边界。

**Architecture:** 后端新增 V2 bootstrap stream、mutation、patch 与 revision 基础设施，继续承担持久化与任务执行；前端新增 `ProjectStore`、`ComputeScheduler`、`WorkerPool`，接管项目运行态与高频派生计算；页面逐步从 V1 `snapshot + invalidation` 迁到 V2 `store + selector + patch` 模型。

**Tech Stack:** Python 3.14、pytest、ruff、Electron、React 19、TypeScript、Vitest、Web Worker、EventSource、Tailwind CSS 4

---

## 范围说明

虽然本特性横跨协议、状态仓、计算运行时与页面迁移四条链路，但它们共享同一套 V2 基础设施，不适合拆成互不关联的独立计划。执行时必须严格按任务顺序推进，前一个任务未完成前不要跳到后一个任务。

## 文件结构

### 后端新增文件

| 路径 | 职责 |
| --- | --- |
| `api/Models/V2/ProjectRuntime.py` | V2 bootstrap 行集块、patch、revision 相关 DTO |
| `api/Contract/V2/BootstrapPayloads.py` | bootstrap stream 各阶段 payload 编码 |
| `api/Contract/V2/MutationPayloads.py` | mutation 请求与 ack/correction 响应编码 |
| `api/Application/V2/ProjectAppService.py` | 承接项目页使用的 V2 `load/create/preview/source-files/unload` 命令包装 |
| `api/Application/V2/ProjectBootstrapAppService.py` | 组装当前已加载项目的分段 bootstrap 流 |
| `api/Application/V2/ProjectMutationAppService.py` | V2 mutation 用例层入口 |
| `api/Application/V2/TaskAppService.py` | 承接 V2 任务命令与任务快照包装 |
| `api/Application/V2/ModelAppService.py` | 承接模型页 V2 命令包装 |
| `api/Application/V2/QualityRuleAppService.py` | 承接质量规则、提示词与资源型 V2 命令包装 |
| `api/Bridge/V2/EventBridge.py` | 把内部事件裁成 V2 patch/task event |
| `api/Server/Routes/V2/EventRoutes.py` | 注册 `/api/v2/events/stream` |
| `api/Server/Routes/V2/ProjectRoutes.py` | 注册 `/api/v2/project/*`，包括 bootstrap、mutation 与项目页命令 |
| `api/Server/Routes/V2/TaskRoutes.py` | 注册 `/api/v2/tasks/*` |
| `api/Server/Routes/V2/ModelRoutes.py` | 注册 `/api/v2/models/*` |
| `api/Server/Routes/V2/QualityRoutes.py` | 注册 `/api/v2/quality/*` |
| `module/Data/Project/V2/RuntimeService.py` | 从 `DataManager` 构建 V2 runtime snapshot 与 row block |
| `module/Data/Project/V2/MutationService.py` | 解释 mutation 并落盘，产出 ack/correction patch |
| `module/Data/Project/V2/RevisionService.py` | 管理 `projectRevision` 与 `sectionRevisions` |

### 前端新增文件

| 路径 | 职责 |
| --- | --- |
| `frontend/vitest.config.ts` | renderer 侧 Vitest 配置 |
| `frontend/src/test/setup.ts` | 前端测试环境初始化 |
| `frontend/src/renderer/app/state/v2/runtime-feature.ts` | V2 粗粒度开关 |
| `frontend/src/renderer/app/state/v2/project-store.ts` | 统一项目状态仓 |
| `frontend/src/renderer/app/state/v2/bootstrap-stream.ts` | bootstrap stream 读取与解析 |
| `frontend/src/renderer/app/state/v2/selectors.ts` | 工作台、校对、规则页通用 selector |
| `frontend/src/renderer/app/state/v2/compute-scheduler.ts` | Worker 任务切片、取消、去抖与结果回并 |
| `frontend/src/renderer/app/state/v2/derived-cache.ts` | 高成本派生结果缓存 |
| `frontend/src/renderer/app/state/v2/workers/worker.types.ts` | Worker 消息协议 |
| `frontend/src/renderer/app/state/v2/workers/proofreading-worker.ts` | 校对检查与筛选的 Worker 主体 |
| `frontend/src/renderer/app/state/v2/workers/quality-statistics-worker.ts` | 规则统计 Worker 主体 |
| `frontend/src/renderer/app/state/v2/workers/worker-client.ts` | Worker 池客户端 |
| `frontend/src/renderer/app/state/v2/use-project-runtime.ts` | 应用壳层接入 V2 runtime |

### 重点修改文件

| 路径 | 修改目的 |
| --- | --- |
| `api/Server/ServerBootstrap.py` | 注册 V2 路由与 V2 event stream |
| `api/Application/EventStreamService.py` | 作为共享 SSE 传输层，并行支持 V1/V2 事件流，迁移期保留双轨 |
| `api/Server/Routes/EventRoutes.py` | 暂留 V1，全局事件流对比回归使用 |
| `api/Bridge/EventBridge.py` | 仅维持 V1；迁移后删除 |
| `module/Data/DataManager.py` | 暴露 V2 runtime builder、mutation、revision、patch 入口 |
| `frontend/package.json` | 增加 `test`/`test:watch` 等脚本 |
| `frontend/src/renderer/app/state/desktop-runtime-context.tsx` | 保留应用壳层职责，把 V2 协议逻辑下沉后改成薄装配入口 |
| `frontend/src/renderer/app/state/project-pages-barrier.ts` | 从页面预热屏障切到 V2 runtime ready |
| `frontend/src/renderer/pages/project-page/page.tsx` | 打开/创建项目后切入 V2 bootstrap |
| `frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts` | 使用 `ProjectStore` 替代 `/api/workbench/snapshot` |
| `frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts` | 使用 `ProjectStore + Worker` 替代 `/api/proofreading/snapshot/filter` |
| `frontend/src/renderer/pages/glossary-page/use-glossary-page-state.ts` | 使用 `ProjectStore + Worker` 替代规则快照与统计接口主路径 |
| `frontend/src/renderer/pages/text-preserve-page/use-text-preserve-page-state.ts` | 迁移到 V2 quality state |
| `frontend/src/renderer/pages/text-replacement-page/use-text-replacement-page-state.ts` | 迁移到 V2 quality state |
| `frontend/src/renderer/pages/custom-prompt-page/use-custom-prompt-page-state.ts` | 迁移到 V2 prompt state |

### 重点测试文件

| 路径 | 目的 |
| --- | --- |
| `tests/module/data/v2/test_runtime_service.py` | 验证 runtime snapshot 与 row block 编码 |
| `tests/module/data/v2/test_mutation_service.py` | 验证 mutation 落盘、revision、patch |
| `tests/api/application/v2/test_project_bootstrap_app_service.py` | 验证 bootstrap stream 阶段顺序 |
| `tests/api/application/v2/test_project_mutation_app_service.py` | 验证 ack/correction 语义 |
| `tests/api/bridge/v2/test_event_bridge.py` | 验证 V2 patch/task event 裁切 |
| `tests/api/server/v2/test_event_routes.py` | 验证 `/api/v2/events/stream` 路由注册 |
| `tests/api/server/v2/test_project_routes.py` | 验证 V2 路由注册、GET stream、POST mutation |
| `tests/api/server/v2/test_task_routes.py` | 验证 `/api/v2/tasks/*` 路由注册与任务命令归属 |
| `tests/api/server/v2/test_model_routes.py` | 验证 `/api/v2/models/*` 路由注册与模型命令归属 |
| `tests/api/server/v2/test_quality_routes.py` | 验证 `/api/v2/quality/*` 路由注册与资源型命令归属 |
| `frontend/src/renderer/app/state/v2/project-store.test.ts` | 验证 store hydration、patch merge |
| `frontend/src/renderer/app/state/v2/bootstrap-stream.test.ts` | 验证 bootstrap 解析与阶段错误处理 |
| `frontend/src/renderer/app/state/v2/compute-scheduler.test.ts` | 验证任务切片、取消与回并 |
| `frontend/src/renderer/app/state/v2/workers/proofreading-worker.test.ts` | 验证校对 Worker 结果与 V1 等价 |
| `frontend/src/renderer/app/state/v2/workers/quality-statistics-worker.test.ts` | 验证规则统计 Worker 结果与 V1 等价 |
| `frontend/src/renderer/pages/workbench-page/use-workbench-live-state.test.ts` | 验证工作台读 store 而非 snapshot |
| `frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.test.ts` | 验证校对页读 store + worker |
| `frontend/src/renderer/pages/glossary-page/use-glossary-page-state.test.ts` | 验证统计与 mutation 联动 |

### V2 路径分轨约束

1. V1 保持当前原始路径与文件位置，不额外补 `/v1`。
2. 所有新增 V2 HTTP / SSE 入口必须统一挂在 `/api/v2/...` 下。
3. 所有新增 V2 边界文件必须统一落在带 `V2` / `v2` 的目录中，例如 `api/**/V2/`、`frontend/**/v2/`。
4. 共享领域逻辑可以继续留在现有公共目录，但协议适配、运行时承载、桥接、测试和文档必须显式分轨。
5. 现有应用壳层或页面装配文件可以保留原路径，但其中新增的 V2 协议逻辑必须下沉到 `V2` / `v2` 目录；原文件只允许保留薄装配或过渡适配职责。
6. 删除 V1 时，以“删除 `/api/v2` 之外仍承载运行态协议的旧边界”和“删除非 `V2` / `v2` 的旧运行时适配代码”为目标，而不是做散点清理。

## 执行约束

1. 每个任务都先写失败测试，再写最小实现。
2. 迁移期间保持 V1 可运行，但新逻辑一律优先接入 `/api/v2/...` 与 `V2` / `v2` 边界路径。
3. 不为 V1 新增 `/v1` 前缀；V1 只保留原位存量，等待最终整体删除。
4. 页面迁移完成后，立即删除对应页面对 V1 `snapshot` 的消费代码，不保留双读。
5. Worker 产出只能作为派生缓存，不能反向成为新的实体真相。
6. 所有用户可见行为变更都按 bug 处理，优先回归到 V1 结果口径。

### Task 1: 搭建前端测试基建与 V2 状态仓骨架

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/renderer/app/state/v2/runtime-feature.ts`
- Create: `frontend/src/renderer/app/state/v2/project-store.ts`
- Test: `frontend/src/renderer/app/state/v2/project-store.test.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: 先写失败测试，定义 `ProjectStore` 最小行为**

```ts
import { describe, expect, it } from 'vitest'

import { createProjectStore } from './project-store'

describe('createProjectStore', () => {
  it('按 section 独立写入 bootstrap 阶段数据', () => {
    const store = createProjectStore()

    store.applyBootstrapStage('project', {
      project: { path: 'E:/demo/demo.lg', loaded: true },
      revisions: { projectRevision: 1, sections: { project: 1 } },
    })

    expect(store.getState().project.path).toBe('E:/demo/demo.lg')
    expect(store.getState().revisions.projectRevision).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试，确认当前仓库还没有前端测试跑道且测试失败**

Run:

```bash
cd frontend
npx vitest run src/renderer/app/state/v2/project-store.test.ts
```

Expected:

```text
FAIL  Cannot find module './project-store'
```

- [ ] **Step 3: 增加 Vitest 脚本、测试配置和最小 `ProjectStore` 实现**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```ts
// frontend/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

```ts
// frontend/src/renderer/app/state/v2/project-store.ts
export function createProjectStore() {
  let state = {
    project: { path: '', loaded: false },
    files: {},
    items: {},
    quality: {},
    prompts: {},
    analysis: {},
    task: {},
    revisions: { projectRevision: 0, sections: {} as Record<string, number> },
    pendingMutations: [],
  }

  return {
    getState: () => state,
    applyBootstrapStage: (stage: string, payload: Record<string, unknown>) => {
      state = { ...state, ...payload }
    },
  }
}
```

- [ ] **Step 4: 跑前端测试与静态检查，确认骨架可用**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/project-store.test.ts
npm run lint
npx tsc -p tsconfig.json --noEmit
```

Expected:

```text
PASS src/renderer/app/state/v2/project-store.test.ts
```

- [ ] **Step 5: 提交这一小步**

```bash
git add frontend/package.json frontend/vitest.config.ts frontend/src/test/setup.ts frontend/src/renderer/app/state/v2/runtime-feature.ts frontend/src/renderer/app/state/v2/project-store.ts frontend/src/renderer/app/state/v2/project-store.test.ts
git commit -m "test: add frontend v2 runtime harness"
```

### Task 2: 实现后端 V2 runtime snapshot 与 bootstrap 编码

**Files:**
- Create: `api/Models/V2/ProjectRuntime.py`
- Create: `api/Contract/V2/BootstrapPayloads.py`
- Create: `module/Data/Project/V2/RuntimeService.py`
- Modify: `module/Data/DataManager.py`
- Test: `tests/module/data/v2/test_runtime_service.py`
- Test: `tests/api/contract/v2/test_bootstrap_payloads.py`

- [ ] **Step 1: 先写失败测试，定义 row block 与项目设置子集**

```python
from module.Data.Project.V2.RuntimeService import V2ProjectRuntimeService


class StubStatus:
    value = "DONE"


class StubItem:
    def get_id(self):
        return 1

    def get_file_path(self):
        return "chapter01.txt"

    def get_src(self):
        return "原文"

    def get_dst(self):
        return "译文"

    def get_status(self):
        return StubStatus()


class StubDataManager:
    def get_items_all(self):
        return [StubItem()]


def test_build_items_block_uses_schema_and_rows():
    data_manager = StubDataManager()
    service = V2ProjectRuntimeService(data_manager)

    block = service.build_items_block()

    assert block["schema"] == "project-items.v1"
    assert block["fields"] == ["item_id", "file_path", "src", "dst", "status"]
    assert block["rows"] == [[1, "chapter01.txt", "原文", "译文", "DONE"]]
```

- [ ] **Step 2: 运行模块测试，确认失败点落在新服务缺失**

Run:

```bash
uv run pytest tests/module/data/v2/test_runtime_service.py -v
```

Expected:

```text
E   ModuleNotFoundError: No module named 'module.Data.Project.V2.RuntimeService'
```

- [ ] **Step 3: 实现 runtime DTO、payload 与服务最小版本**

```python
# api/Models/V2/ProjectRuntime.py
from dataclasses import dataclass


@dataclass(frozen=True)
class V2RowBlock:
    schema: str
    fields: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "schema": self.schema,
            "fields": list(self.fields),
            "rows": [list(row) for row in self.rows],
        }
```

```python
# module/Data/Project/V2/RuntimeService.py
class V2ProjectRuntimeService:
    def __init__(self, data_manager) -> None:
        self.data_manager = data_manager

    def build_items_block(self) -> dict[str, object]:
        items = self.data_manager.get_items_all()
        return {
            "schema": "project-items.v1",
            "fields": ["item_id", "file_path", "src", "dst", "status"],
            "rows": [
                [item.get_id(), item.get_file_path(), item.get_src(), item.get_dst(), item.get_status().value]
                for item in items
            ],
        }
```

- [ ] **Step 4: 增加 contract 测试，锁住 `stage_payload` 的稳定字段**

```python
from api.Contract.V2.BootstrapPayloads import BootstrapStagePayload


def test_bootstrap_stage_payload_to_dict_keeps_stage_and_payload():
    payload = BootstrapStagePayload(stage="items", payload={"schema": "project-items.v1"})

    assert payload.to_dict() == {
        "type": "stage_payload",
        "stage": "items",
        "payload": {"schema": "project-items.v1"},
    }
```

- [ ] **Step 5: 运行 contract + module 测试**

Run:

```bash
uv run pytest tests/module/data/v2/test_runtime_service.py tests/api/contract/v2/test_bootstrap_payloads.py -v
```

Expected:

```text
2 passed
```

- [ ] **Step 6: 提交这一小步**

```bash
git add api/Models/V2/ProjectRuntime.py api/Contract/V2/BootstrapPayloads.py module/Data/Project/V2/RuntimeService.py module/Data/DataManager.py tests/module/data/v2/test_runtime_service.py tests/api/contract/v2/test_bootstrap_payloads.py
git commit -m "feat: add v2 runtime snapshot encoder"
```

### Task 3: 实现 V2 bootstrap stream 路由与应用服务

**Files:**
- Create: `api/Application/V2/ProjectBootstrapAppService.py`
- Create: `api/Server/Routes/V2/ProjectRoutes.py`
- Modify: `api/Server/ServerBootstrap.py`
- Test: `tests/api/application/v2/test_project_bootstrap_app_service.py`
- Test: `tests/api/server/v2/test_project_routes.py`

- [ ] **Step 1: 先写失败测试，锁住 stage 顺序与 GET stream 形态**

```python
from api.Application.V2.ProjectBootstrapAppService import V2ProjectBootstrapAppService


class StubRuntimeService:
    def build_project_block(self):
        return {"project": {"path": "demo.lg", "loaded": True}}

    def build_items_block(self):
        return {"schema": "project-items.v1", "fields": ["item_id"], "rows": [[1]]}


def test_iter_bootstrap_events_emits_project_items_quality_and_completed():
    app_service = V2ProjectBootstrapAppService(StubRuntimeService())
    events = list(app_service.iter_bootstrap_events({}))

    assert events[0]["type"] == "stage_started"
    assert events[1]["stage"] == "project"
    assert any(event.get("stage") == "items" for event in events)
    assert events[-1]["type"] == "completed"
```

```python
def test_v2_project_routes_register_bootstrap_stream(core_api_server, server_bootstrap):
    server_bootstrap.register_v2_routes(core_api_server)

    route_definition = core_api_server.route_map[("GET", "/api/v2/project/bootstrap/stream")]
    assert route_definition.mode == "stream"
```

- [ ] **Step 2: 跑应用服务与路由测试，确认目前缺失 V2 路由**

Run:

```bash
uv run pytest tests/api/application/v2/test_project_bootstrap_app_service.py tests/api/server/v2/test_project_routes.py -v
```

Expected:

```text
FAIL ... KeyError: ('GET', '/api/v2/project/bootstrap/stream')
```

- [ ] **Step 3: 实现应用服务的流式事件迭代器与路由注册**

```python
# api/Application/V2/ProjectBootstrapAppService.py
class V2ProjectBootstrapAppService:
    def __init__(self, runtime_service) -> None:
        self.runtime_service = runtime_service

    def iter_bootstrap_events(self, request: dict[str, object]):
        del request
        yield {"type": "stage_started", "stage": "project", "message": "正在加载项目骨架"}
        yield {"type": "stage_payload", "stage": "project", "payload": self.runtime_service.build_project_block()}
        yield {"type": "stage_completed", "stage": "project"}
        yield {"type": "stage_payload", "stage": "items", "payload": self.runtime_service.build_items_block()}
        yield {"type": "completed", "projectRevision": 1, "sectionRevisions": {"project": 1, "items": 1}}
```

```python
# api/Server/Routes/V2/ProjectRoutes.py
class V2ProjectRoutes:
    BOOTSTRAP_STREAM_PATH: str = "/api/v2/project/bootstrap/stream"

    @classmethod
    def register(cls, core_api_server, bootstrap_service, mutation_service) -> None:
        core_api_server.add_stream_route(
            cls.BOOTSTRAP_STREAM_PATH,
            lambda handler: bootstrap_service.stream_to_handler(handler),
        )
```

- [ ] **Step 4: 跑测试并补一个 404/未加载项目场景**

Run:

```bash
uv run pytest tests/api/application/v2/test_project_bootstrap_app_service.py tests/api/server/v2/test_project_routes.py -v
```

Expected:

```text
4 passed
```

- [ ] **Step 5: 提交这一小步**

```bash
git add api/Application/V2/ProjectBootstrapAppService.py api/Server/Routes/V2/ProjectRoutes.py api/Server/ServerBootstrap.py tests/api/application/v2/test_project_bootstrap_app_service.py tests/api/server/v2/test_project_routes.py
git commit -m "feat: add v2 bootstrap stream route"
```

### Task 4: 实现 revision、mutation、ack/correction 基础闭环

**Files:**
- Create: `api/Contract/V2/MutationPayloads.py`
- Create: `api/Application/V2/ProjectMutationAppService.py`
- Create: `module/Data/Project/V2/RevisionService.py`
- Create: `module/Data/Project/V2/MutationService.py`
- Modify: `api/Server/Routes/V2/ProjectRoutes.py`
- Modify: `module/Data/DataManager.py`
- Test: `tests/module/data/v2/test_mutation_service.py`
- Test: `tests/api/application/v2/test_project_mutation_app_service.py`

- [ ] **Step 1: 先写失败测试，锁住 `clientMutationId`、`baseRevision` 和 ack 结构**

```python
from module.Data.Project.V2.MutationService import V2ProjectMutationService
from module.Data.Project.V2.RevisionService import V2ProjectRevisionService


class StubDataManager:
    def update_item_text(self, item_id: int, dst: str) -> None:
        self.last_update = (item_id, dst)


def test_apply_mutations_returns_ack_with_new_revision():
    service = V2ProjectMutationService(StubDataManager(), V2ProjectRevisionService())
    result = service.apply_mutations({
        "clientMutationId": "m-001",
        "baseRevision": 3,
        "mutations": [{
            "type": "item.update_text",
            "itemId": 1,
            "fields": {"dst": "新译文"},
        }],
    })

    assert result["clientMutationId"] == "m-001"
    assert result["accepted"] is True
    assert result["newRevision"] == 4
    assert result["updatedSections"] == ["items"]
```

- [ ] **Step 2: 跑失败测试，确认当前没有 V2 mutation 服务**

Run:

```bash
uv run pytest tests/module/data/v2/test_mutation_service.py tests/api/application/v2/test_project_mutation_app_service.py -v
```

Expected:

```text
E   ModuleNotFoundError: No module named 'module.Data.Project.V2.MutationService'
```

- [ ] **Step 3: 实现 revision 服务和 mutation 服务的最小闭环**

```python
class V2ProjectRevisionService:
    def __init__(self) -> None:
        self.project_revision = 0
        self.section_revisions = {"project": 0, "files": 0, "items": 0, "quality": 0, "prompts": 0, "analysis": 0, "task": 0}

    def bump(self, *sections: str) -> tuple[int, dict[str, int]]:
        self.project_revision += 1
        for section in sections:
            self.section_revisions[section] += 1
        return self.project_revision, dict(self.section_revisions)
```

```python
class V2ProjectMutationService:
    def apply_mutations(self, envelope: dict[str, object]) -> dict[str, object]:
        client_mutation_id = str(envelope["clientMutationId"])
        project_revision, section_revisions = self.revision_service.bump("items")
        return {
            "clientMutationId": client_mutation_id,
            "accepted": True,
            "newRevision": project_revision,
            "updatedSections": ["items"],
            "sectionRevisions": section_revisions,
            "appliedMutations": [{"index": 0, "status": "applied"}],
        }
```

- [ ] **Step 4: 增加 correction/reject 测试，锁住冲突路径**

```python
def test_apply_mutations_returns_rejected_for_stale_base_revision():
    service = V2ProjectMutationService(StubDataManager(), V2ProjectRevisionService())
    service.revision_service.project_revision = 9

    result = service.apply_mutations({
        "clientMutationId": "m-002",
        "baseRevision": 3,
        "mutations": [],
    })

    assert result["accepted"] is False
    assert result["appliedMutations"][0]["status"] == "rejected"
    assert result["appliedMutations"][0]["error"]["code"] == "stale_base_revision"
```

- [ ] **Step 5: 跑测试，确认 ack/reject 都稳定**

Run:

```bash
uv run pytest tests/module/data/v2/test_mutation_service.py tests/api/application/v2/test_project_mutation_app_service.py -v
```

Expected:

```text
4 passed
```

- [ ] **Step 6: 提交这一小步**

```bash
git add api/Contract/V2/MutationPayloads.py api/Application/V2/ProjectMutationAppService.py module/Data/Project/V2/RevisionService.py module/Data/Project/V2/MutationService.py module/Data/DataManager.py tests/module/data/v2/test_mutation_service.py tests/api/application/v2/test_project_mutation_app_service.py
git commit -m "feat: add v2 mutation revision loop"
```

### Task 5: 实现 V2 event bridge 与 task patch 事件流

**Files:**
- Create: `api/Bridge/V2/EventBridge.py`
- Create: `api/Server/Routes/V2/EventRoutes.py`
- Modify: `api/Application/EventStreamService.py`
- Test: `tests/api/bridge/v2/test_event_bridge.py`
- Test: `tests/api/server/v2/test_event_routes.py`
- Modify: `tests/api/application/test_event_stream_service.py`

- [ ] **Step 1: 先写失败测试，定义任务完成时的 V2 patch 事件**

```python
def test_v2_event_bridge_maps_translation_done_to_task_patch(v2_event_bridge):
    topic, payload = v2_event_bridge.map_event("translation_done", {
        "item_ids": [1, 2],
        "revision": 5,
    })

    assert topic == "project.patch"
    assert payload["source"] == "task"
    assert payload["updatedSections"] == ["items", "task"]
```

- [ ] **Step 2: 跑 bridge 测试，确认新桥还不存在**

Run:

```bash
uv run pytest tests/api/bridge/v2/test_event_bridge.py -v
```

Expected:

```text
E   ModuleNotFoundError: No module named 'api.Bridge.V2.EventBridge'
```

- [ ] **Step 3: 写最小桥接实现，新增 `/api/v2/events/stream` 路由，并把事件流服务扩成 V1/V2 双路输出**

```python
class V2EventBridge:
    def map_event(self, event: str, data: dict[str, object]) -> tuple[str | None, dict[str, object]]:
        if event == "translation_done":
            return "project.patch", {
                "source": "task",
                "projectRevision": int(data["revision"]),
                "updatedSections": ["items", "task"],
                "patch": [{"op": "merge_items", "item_ids": list(data["item_ids"])}],
            }
        return None, {}
```

- [ ] **Step 4: 跑 bridge + event stream 测试，确认旧流未破坏、新流可注册**

Run:

```bash
uv run pytest tests/api/bridge/v2/test_event_bridge.py tests/api/application/test_event_stream_service.py -v
```

Expected:

```text
PASS
```

- [ ] **Step 5: 提交这一小步**

```bash
git add api/Bridge/V2/EventBridge.py api/Server/Routes/V2/EventRoutes.py api/Application/EventStreamService.py tests/api/bridge/v2/test_event_bridge.py tests/api/server/v2/test_event_routes.py tests/api/application/test_event_stream_service.py
git commit -m "feat: add v2 patch event bridge"
```

### Task 6: 接入 bootstrap stream 与桌面运行时

**Files:**
- Create: `frontend/src/renderer/app/state/v2/bootstrap-stream.ts`
- Create: `frontend/src/renderer/app/state/v2/use-project-runtime.ts`
- Modify: `frontend/src/renderer/app/state/desktop-runtime-context.tsx`
- Modify: `frontend/src/renderer/app/state/project-pages-barrier.ts`
- Modify: `frontend/src/renderer/pages/project-page/page.tsx`
- Test: `frontend/src/renderer/app/state/v2/bootstrap-stream.test.ts`

- [ ] **Step 1: 先写失败测试，定义 bootstrap 解析器的阶段回调**

```ts
import { describe, expect, it } from 'vitest'

import { consumeBootstrapStream } from './bootstrap-stream'

describe('consumeBootstrapStream', () => {
  it('按 stage 顺序把 payload 写入 store', async () => {
    const applied: string[] = []
    await consumeBootstrapStream({
      open: async function* () {
        yield { type: 'stage_payload', stage: 'project', payload: { project: { path: 'demo', loaded: true } } }
        yield { type: 'completed', projectRevision: 1, sectionRevisions: { project: 1 } }
      },
      onStagePayload: (stage) => applied.push(stage),
    })

    expect(applied).toEqual(['project'])
  })
})
```

- [ ] **Step 2: 跑前端测试，确认解析器尚未实现**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/bootstrap-stream.test.ts
```

Expected:

```text
FAIL  Cannot find module './bootstrap-stream'
```

- [ ] **Step 3: 写最小 bootstrap consumer，并在桌面运行时接入 V2 开关**

```ts
export async function consumeBootstrapStream(args: {
  open: () => AsyncIterable<Record<string, unknown>>
  onStagePayload: (stage: string, payload: Record<string, unknown>) => void
}) {
  for await (const event of args.open()) {
    if (event.type === 'stage_payload') {
      args.onStagePayload(String(event.stage), event.payload as Record<string, unknown>)
    }
  }
}
```

```ts
// desktop-runtime-context.tsx
const v2Runtime = createV2ProjectRuntime({ store: projectStore, openBootstrapStream })

if (isV2RuntimeEnabled()) {
  await v2Runtime.bootstrap(projectPath)
  return
}
```

- [ ] **Step 4: 跑前端测试与类型检查**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/bootstrap-stream.test.ts
npm run lint
npx tsc -p tsconfig.json --noEmit
```

Expected:

```text
PASS src/renderer/app/state/v2/bootstrap-stream.test.ts
```

- [ ] **Step 5: 提交这一小步**

```bash
git add frontend/src/renderer/app/state/v2/bootstrap-stream.ts frontend/src/renderer/app/state/v2/use-project-runtime.ts frontend/src/renderer/app/state/desktop-runtime-context.tsx frontend/src/renderer/app/state/project-pages-barrier.ts frontend/src/renderer/pages/project-page/page.tsx frontend/src/renderer/app/state/v2/bootstrap-stream.test.ts
git commit -m "feat: wire desktop runtime to v2 bootstrap"
```

### Task 7: 迁移工作台到 `ProjectStore`

**Files:**
- Create: `frontend/src/renderer/app/state/v2/selectors.ts`
- Modify: `frontend/src/renderer/pages/workbench-page/types.ts`
- Modify: `frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts`
- Modify: `frontend/src/renderer/pages/workbench-page/page.tsx`
- Test: `frontend/src/renderer/pages/workbench-page/use-workbench-live-state.test.ts`

- [ ] **Step 1: 先写失败测试，锁住“工作台不再请求 `/api/workbench/snapshot`”**

```ts
import { describe, expect, it, vi } from 'vitest'

import { buildWorkbenchView } from '@/app/state/v2/selectors'

describe('buildWorkbenchView', () => {
  it('直接从 items/files 生成工作台条目', () => {
    const view = buildWorkbenchView({
      files: { 'chapter01.txt': { rel_path: 'chapter01.txt', file_type: 'TXT' } },
      items: { '1': { item_id: 1, file_path: 'chapter01.txt', status: 'DONE' } },
    })

    expect(view.entries[0]?.rel_path).toBe('chapter01.txt')
    expect(view.summary.translated).toBe(1)
  })
})
```

- [ ] **Step 2: 跑失败测试，确认 selector 尚未提供**

Run:

```bash
cd frontend
npm run test -- src/renderer/pages/workbench-page/use-workbench-live-state.test.ts
```

Expected:

```text
FAIL  Cannot find module '@/app/state/v2/selectors'
```

- [ ] **Step 3: 写 selector，并把 `use-workbench-live-state.ts` 的首拉改成读 store**

```ts
export function buildWorkbenchView(state: {
  files: Record<string, { rel_path: string; file_type: string }>
  items: Record<string, { file_path: string; status: string }>
}) {
  const entries = Object.values(state.files).map((file) => ({
    rel_path: file.rel_path,
    file_type: file.file_type,
    item_count: Object.values(state.items).filter((item) => item.file_path === file.rel_path).length,
  }))

  return {
    entries,
    summary: {
      translated: Object.values(state.items).filter((item) => item.status === 'DONE').length,
    },
  }
}
```

- [ ] **Step 4: 跑工作台测试、lint、类型检查**

Run:

```bash
cd frontend
npm run test -- src/renderer/pages/workbench-page/use-workbench-live-state.test.ts
npm run lint
npx tsc -p tsconfig.json --noEmit
```

Expected:

```text
PASS src/renderer/pages/workbench-page/use-workbench-live-state.test.ts
```

- [ ] **Step 5: 提交这一小步**

```bash
git add frontend/src/renderer/app/state/v2/selectors.ts frontend/src/renderer/pages/workbench-page/types.ts frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts frontend/src/renderer/pages/workbench-page/page.tsx frontend/src/renderer/pages/workbench-page/use-workbench-live-state.test.ts
git commit -m "feat: migrate workbench to project store"
```

### Task 8: 建立 Worker 运行时并迁移校对检查算法

**Files:**
- Create: `frontend/src/renderer/app/state/v2/compute-scheduler.ts`
- Create: `frontend/src/renderer/app/state/v2/derived-cache.ts`
- Create: `frontend/src/renderer/app/state/v2/workers/worker.types.ts`
- Create: `frontend/src/renderer/app/state/v2/workers/proofreading-worker.ts`
- Create: `frontend/src/renderer/app/state/v2/workers/worker-client.ts`
- Test: `frontend/src/renderer/app/state/v2/compute-scheduler.test.ts`
- Test: `frontend/src/renderer/app/state/v2/workers/proofreading-worker.test.ts`

- [ ] **Step 1: 先写失败测试，锁住 Worker 结果与 V1 校对语义一致**

```ts
import { describe, expect, it } from 'vitest'

import { runProofreadingWorkerTask } from './workers/proofreading-worker'

describe('runProofreadingWorkerTask', () => {
  it('识别术语未生效和相似度过高', async () => {
    const result = await runProofreadingWorkerTask({
      items: [{ item_id: 1, src: '苹果很好吃', dst: '苹果很好吃', status: 'DONE', file_path: 'a.txt' }],
      glossary: [{ src: '苹果', dst: 'Apple' }],
      config: { source_language: 'JA', check_similarity: true },
    })

    expect(result.warningMap['1']).toContain('SIMILARITY')
    expect(result.warningMap['1']).toContain('GLOSSARY')
  })
})
```

- [ ] **Step 2: 跑失败测试，确认 Worker 入口缺失**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/workers/proofreading-worker.test.ts
```

Expected:

```text
FAIL  Cannot find module './workers/proofreading-worker'
```

- [ ] **Step 3: 写最小 Worker 与调度器实现**

```ts
export async function runProofreadingWorkerTask(input: {
  items: Array<{ item_id: number; src: string; dst: string; status: string; file_path: string }>
  glossary: Array<{ src: string; dst: string }>
  config: { source_language: string; check_similarity: boolean }
}) {
  const warningMap: Record<string, string[]> = {}

  for (const item of input.items) {
    const warnings: string[] = []
    if (input.config.check_similarity && item.src === item.dst) {
      warnings.push('SIMILARITY')
    }
    if (input.glossary.some((term) => item.src.includes(term.src) && !item.dst.includes(term.dst))) {
      warnings.push('GLOSSARY')
    }
    warningMap[String(item.item_id)] = warnings
  }

  return { warningMap }
}
```

```ts
export class ComputeScheduler {
  async runProofreadingTask(input: Parameters<typeof runProofreadingWorkerTask>[0]) {
    return runProofreadingWorkerTask(input)
  }
}
```

- [ ] **Step 4: 跑 Worker 测试，并补取消语义测试**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/workers/proofreading-worker.test.ts src/renderer/app/state/v2/compute-scheduler.test.ts
```

Expected:

```text
2 passed
```

- [ ] **Step 5: 提交这一小步**

```bash
git add frontend/src/renderer/app/state/v2/compute-scheduler.ts frontend/src/renderer/app/state/v2/derived-cache.ts frontend/src/renderer/app/state/v2/workers/worker.types.ts frontend/src/renderer/app/state/v2/workers/proofreading-worker.ts frontend/src/renderer/app/state/v2/workers/worker-client.ts frontend/src/renderer/app/state/v2/compute-scheduler.test.ts frontend/src/renderer/app/state/v2/workers/proofreading-worker.test.ts
git commit -m "feat: add proofreading worker runtime"
```

### Task 9: 迁移校对页到 `ProjectStore + Worker`

**Files:**
- Modify: `frontend/src/renderer/pages/proofreading-page/types.ts`
- Modify: `frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts`
- Modify: `frontend/src/renderer/pages/proofreading-page/page.tsx`
- Test: `frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.test.ts`

- [ ] **Step 1: 先写失败测试，锁住筛选和可见列表来自 store + worker**

```ts
import { describe, expect, it } from 'vitest'

import { buildProofreadingVisibleItems } from './use-proofreading-page-state'

describe('buildProofreadingVisibleItems', () => {
  it('使用 worker warning map 和 store items 生成可见项', () => {
    const result = buildProofreadingVisibleItems({
      items: [{ item_id: 1, file_path: 'a.txt', src: '原文', dst: '译文', status: 'DONE' }],
      warningMap: { '1': ['SIMILARITY'] },
      filters: { warning_types: ['SIMILARITY'] },
    })

    expect(result[0]?.warnings).toEqual(['SIMILARITY'])
  })
})
```

- [ ] **Step 2: 跑失败测试，确认当前 hook 还绑着 snapshot 流程**

Run:

```bash
cd frontend
npm run test -- src/renderer/pages/proofreading-page/use-proofreading-page-state.test.ts
```

Expected:

```text
FAIL  buildProofreadingVisibleItems is not exported
```

- [ ] **Step 3: 把校对页首拉、筛选和局部刷新改成 store + scheduler**

```ts
export function buildProofreadingVisibleItems(args: {
  items: Array<{ item_id: number; file_path: string; src: string; dst: string; status: string }>
  warningMap: Record<string, string[]>
  filters: { warning_types: string[] }
}) {
  return args.items
    .map((item) => ({
      ...item,
      warnings: args.warningMap[String(item.item_id)] ?? [],
    }))
    .filter((item) => {
      return args.filters.warning_types.length === 0
        || item.warnings.some((warning) => args.filters.warning_types.includes(warning))
    })
}
```

- [ ] **Step 4: 跑校对页测试，并补一个 mutation 后自动重算的场景**

Run:

```bash
cd frontend
npm run test -- src/renderer/pages/proofreading-page/use-proofreading-page-state.test.ts
npm run lint
npx tsc -p tsconfig.json --noEmit
```

Expected:

```text
PASS src/renderer/pages/proofreading-page/use-proofreading-page-state.test.ts
```

- [ ] **Step 5: 提交这一小步**

```bash
git add frontend/src/renderer/pages/proofreading-page/types.ts frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts frontend/src/renderer/pages/proofreading-page/page.tsx frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.test.ts
git commit -m "feat: migrate proofreading page to v2 runtime"
```

### Task 10: 迁移规则页统计与质量规则编辑主路径

**Files:**
- Create: `frontend/src/renderer/app/state/v2/workers/quality-statistics-worker.ts`
- Test: `frontend/src/renderer/app/state/v2/workers/quality-statistics-worker.test.ts`
- Modify: `frontend/src/renderer/pages/glossary-page/use-glossary-page-state.ts`
- Modify: `frontend/src/renderer/pages/text-preserve-page/use-text-preserve-page-state.ts`
- Modify: `frontend/src/renderer/pages/text-replacement-page/use-text-replacement-page-state.ts`
- Modify: `frontend/src/renderer/pages/custom-prompt-page/use-custom-prompt-page-state.ts`
- Test: `frontend/src/renderer/pages/glossary-page/use-glossary-page-state.test.ts`

- [ ] **Step 1: 先写失败测试，锁住统计结果与 V1 口径一致**

```ts
import { describe, expect, it } from 'vitest'

import { runQualityStatisticsWorkerTask } from './workers/quality-statistics-worker'

describe('runQualityStatisticsWorkerTask', () => {
  it('返回命中数和包含关系', async () => {
    const result = await runQualityStatisticsWorkerTask({
      rules: [{ key: '苹果|1', pattern: '苹果', mode: 'glossary', case_sensitive: true }],
      srcTexts: ['苹果很好吃', '香蕉一般'],
      dstTexts: [],
    })

    expect(result.results['苹果|1']?.matched_item_count).toBe(1)
  })
})
```

- [ ] **Step 2: 跑失败测试，确认统计 Worker 尚未实现**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/workers/quality-statistics-worker.test.ts
```

Expected:

```text
FAIL  Cannot find module './workers/quality-statistics-worker'
```

- [ ] **Step 3: 实现统计 Worker，并把术语/文本规则页改成读 `quality` state**

```ts
export async function runQualityStatisticsWorkerTask(input: {
  rules: Array<{ key: string; pattern: string; mode: string; case_sensitive?: boolean }>
  srcTexts: string[]
  dstTexts: string[]
}) {
  const results: Record<string, { matched_item_count: number }> = {}

  for (const rule of input.rules) {
    results[rule.key] = {
      matched_item_count: input.srcTexts.filter((text) => text.includes(rule.pattern)).length,
    }
  }

  return { results, subset_parents: {} }
}
```

- [ ] **Step 4: 跑规则页测试与前端静态检查**

Run:

```bash
cd frontend
npm run test -- src/renderer/app/state/v2/workers/quality-statistics-worker.test.ts src/renderer/pages/glossary-page/use-glossary-page-state.test.ts
npm run lint
npx tsc -p tsconfig.json --noEmit
```

Expected:

```text
PASS
```

- [ ] **Step 5: 提交这一小步**

```bash
git add frontend/src/renderer/app/state/v2/workers/quality-statistics-worker.ts frontend/src/renderer/app/state/v2/workers/quality-statistics-worker.test.ts frontend/src/renderer/pages/glossary-page/use-glossary-page-state.ts frontend/src/renderer/pages/text-preserve-page/use-text-preserve-page-state.ts frontend/src/renderer/pages/text-replacement-page/use-text-replacement-page-state.ts frontend/src/renderer/pages/custom-prompt-page/use-custom-prompt-page-state.ts frontend/src/renderer/pages/glossary-page/use-glossary-page-state.test.ts
git commit -m "feat: migrate quality pages to v2 runtime"
```

### Task 11: 接入任务回灌、切走主消费并同步文档

**Files:**
- Modify: `frontend/src/renderer/app/state/use-analysis-task-runtime.ts`
- Modify: `frontend/src/renderer/app/state/use-translation-task-runtime.ts`
- Modify: `frontend/src/renderer/app/state/desktop-runtime-context.tsx`
- Modify: `api/Application/EventStreamService.py`
- Modify: `api/Bridge/V2/EventBridge.py`
- Modify: `api/Server/Routes/V2/EventRoutes.py`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `api/SPEC.md`
- Modify: `frontend/SPEC.md`
- Modify: `frontend/src/renderer/SPEC.md`
- Modify: `module/Data/SPEC.md`
- Test: `tests/api/server/v2/test_event_routes.py`
- Test: `tests/api/bridge/v2/test_event_bridge.py`
- Modify: `tests/api/application/test_event_stream_service.py`

- [x] **Step 1: 先写失败测试，锁住任务完成后不再依赖页面 invalidation**

```python
from api.Bridge.V2.EventBridge import V2EventBridge


def test_v2_task_patch_replaces_proofreading_invalidation():
    bridge = V2EventBridge()
    topic, payload = bridge.map_event("translation_done", {
        "item_ids": [1],
        "revision": 8,
    })

    assert topic == "project.patch"
    assert payload["source"] == "task"
```

- [x] **Step 2: 跑失败测试，确认仍存在 V1 invalidation 依赖**

Run:

```bash
uv run pytest tests/api/server/v2/test_event_routes.py tests/api/bridge/v2/test_event_bridge.py tests/api/application/test_event_stream_service.py -v
```

Expected:

```text
FAIL  expected 'project.patch'
```

- [x] **Step 3: 删除页面侧 V1 `snapshot/invalidation` 主路径，并同步文档**

```python
# EventBridge.py
elif event == Base.Event.WORKBENCH_REFRESH:
    return None, {}
elif event == Base.Event.PROOFREADING_REFRESH:
    return None, {}
```

```ts
// desktop-runtime-context.tsx
event_source.addEventListener('project.patch', handleProjectPatch as EventListener)
```

```md
## api/SPEC.md
- 新增 `/api/v2/project/bootstrap/stream`
- 新增 `/api/v2/project/mutations/apply`
- 新增 `project.patch`
```

- [x] **Step 4: 跑全套关键验证**

Run:

```bash
uv run pytest tests/api/application tests/api/bridge tests/api/server tests/module/data -v
cd frontend
npm run test
npm run lint
npm run renderer:audit
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

Expected:

```text
全部通过；前端不再直接请求 /api/workbench/snapshot 与 /api/proofreading/snapshot
```

- [x] **Step 5: 提交这一小步**

```bash
git add api/Application/EventStreamService.py api/Bridge/V2/EventBridge.py api/Server/Routes/V2/EventRoutes.py frontend/src/renderer/app/state/use-analysis-task-runtime.ts frontend/src/renderer/app/state/use-translation-task-runtime.ts frontend/src/renderer/app/state/desktop-runtime-context.tsx docs/ARCHITECTURE.md api/SPEC.md frontend/SPEC.md frontend/src/renderer/SPEC.md module/Data/SPEC.md tests/api/server/v2/test_event_routes.py tests/api/bridge/v2/test_event_bridge.py tests/api/application/test_event_stream_service.py
git commit -m "refactor: switch runtime to v2 and retire v1 paths"
```

### Task 12: 补齐 V2 路由组骨架与替换矩阵

**Files:**
- Create: `api/Server/Routes/V2/TaskRoutes.py`
- Create: `api/Server/Routes/V2/ModelRoutes.py`
- Create: `api/Server/Routes/V2/QualityRoutes.py`
- Modify: `api/Server/Routes/V2/ProjectRoutes.py`
- Modify: `api/Server/Routes/V2/EventRoutes.py`
- Modify: `api/Server/ServerBootstrap.py`
- Modify: `docs/superpowers/specs/2026-04-21-v2-project-runtime-protocol-design.md`
- Modify: `docs/superpowers/plans/2026-04-21-v2-project-runtime-implementation.md`

- [x] **Step 1: 先写失败测试，锁住 V2 URL 族拥有独立的版本化路由组**

```text
期望：
- `/api/v2/project/*`、`/api/v2/events/stream`、`/api/v2/tasks/*`、`/api/v2/models/*`、`/api/v2/quality/*`
  都有明确的 V2 路由归属
- 替换矩阵覆盖现有 `project/task/model/quality/workbench/proofreading` 旧入口
```

- [x] **Step 2: 补齐 V2 路由组和替换矩阵，明确哪些旧路由会被哪条新路由接管**

```text
至少补齐：
- `api/Server/Routes/V2/EventRoutes.py`
- `api/Server/Routes/V2/TaskRoutes.py`
- `api/Server/Routes/V2/ModelRoutes.py`
- `api/Server/Routes/V2/QualityRoutes.py`
- 文档里的 V1 -> V2 替换矩阵
```

当前已对齐的替换矩阵：

| V1 | V2 |
| --- | --- |
| `/api/project/load` | `/api/v2/project/load` |
| `/api/project/create` | `/api/v2/project/create` |
| `/api/project/snapshot` | `/api/v2/project/snapshot` |
| `/api/project/unload` | `/api/v2/project/unload` |
| `/api/project/extensions` | `/api/v2/project/extensions` |
| `/api/project/source-files` | `/api/v2/project/source-files` |
| `/api/project/preview` | `/api/v2/project/preview` |
| `/api/tasks/*` | `/api/v2/tasks/*` |
| `/api/models/*` | `/api/v2/models/*` |
| `/api/quality/*` | `/api/v2/quality/*` |
| `/api/workbench/*` | `/api/v2/project/workbench/*` |
| `/api/proofreading/*` | `/api/v2/project/proofreading/*` |
| `/api/events/stream` | `/api/v2/events/stream`（项目运行态主路径） |

- [x] **Step 3: 跑 V2 路由定向测试，确认版本化路由骨架齐全**

Run:

```bash
uv run pytest tests/api/server/v2 -v
```

- [x] **Step 4: 提交这一小步**

```bash
git add api/Server/Routes/V2 api/Server/ServerBootstrap.py docs/superpowers/specs/2026-04-21-v2-project-runtime-protocol-design.md docs/superpowers/plans/2026-04-21-v2-project-runtime-implementation.md
git commit -m "docs: align v2 route groups and replacement matrix"
```

### Task 13: 全量切换剩余前后端主路径到 `/api/v2/...`

**Files:**
- Modify: `frontend/src/renderer/pages/model-page/use-model-page-state.ts`
- Modify: `frontend/src/renderer/pages/project-page/page.tsx`
- Modify: `frontend/src/renderer/app/state/use-analysis-task-runtime.ts`
- Modify: `frontend/src/renderer/app/state/use-translation-task-runtime.ts`
- Modify: `frontend/src/renderer/pages/workbench-page/use-workbench-live-state.ts`
- Modify: `frontend/src/renderer/pages/proofreading-page/use-proofreading-page-state.ts`
- Modify: `frontend/src/renderer/pages/glossary-page/use-glossary-page-state.ts`
- Modify: `frontend/src/renderer/pages/text-preserve-page/use-text-preserve-page-state.ts`
- Modify: `frontend/src/renderer/pages/text-replacement-page/use-text-replacement-page-state.ts`
- Modify: `frontend/src/renderer/pages/custom-prompt-page/use-custom-prompt-page-state.ts`
- Create: `api/Application/V2/ProjectAppService.py`
- Modify: `api/Application/V2/ProjectBootstrapAppService.py`
- Create: `api/Application/V2/TaskAppService.py`
- Create: `api/Application/V2/ModelAppService.py`
- Create: `api/Application/V2/QualityRuleAppService.py`
- Modify: `api/Server/Routes/V2/*`
- Test: `tests/api/server/v2/test_task_routes.py`
- Test: `tests/api/server/v2/test_model_routes.py`
- Test: `tests/api/server/v2/test_quality_routes.py`

- [x] **Step 1: 先写失败测试，列出仍在消费旧 URL 的页面与运行时入口**

```text
必须清零的旧 URL 包括：
- `/api/project/*`
- `/api/workbench/*`
- `/api/proofreading/*`
- `/api/quality/*`
- `/api/models/*`
- 旧版 `/api/tasks/*`
```

- [x] **Step 2: 把剩余读写命令、资源操作与模型页全部切到 `/api/v2/...`**

```text
至少覆盖：
- project page 的 `preview`、`source-files`、`load`、`create`、`unload`
- task 的 `snapshot`、`start/stop`、`reset`、`import-analysis-glossary`、`export-translation`
- model page 的 `snapshot`、`update`、`add`、`activate`、`reorder`、`delete`、`reset-preset`、`list-available`、`test`
- quality 的 snapshot、save、preset、import/export、query-proofreading
- proofreading 与 workbench 的残余 patch / mutation 请求
```

- [x] **Step 3: 跑扫描与页面测试，确认 renderer 主路径不再引用旧 URL**

Run:

```bash
Get-ChildItem -Path 'frontend/src/renderer' -Recurse -Include *.ts,*.tsx | Select-String -Pattern '/api/project/|/api/workbench/|/api/proofreading/|/api/quality/|/api/models/|/api/tasks/'
cd frontend
npm run test
npm run lint
npx tsc -p tsconfig.json --noEmit
```

Expected:

```text
除了明确保留到最终删除步骤的旧壳层兼容代码外，renderer 主路径不再命中 `/api/project/|/api/workbench/|/api/proofreading/|/api/quality/|/api/models/|/api/tasks/` 旧 URL
```

- [x] **Step 4: 提交这一小步**

```bash
git add frontend/src/renderer/pages/model-page frontend/src/renderer/pages/project-page frontend/src/renderer/app/state frontend/src/renderer/pages/workbench-page frontend/src/renderer/pages/proofreading-page frontend/src/renderer/pages/glossary-page frontend/src/renderer/pages/text-preserve-page frontend/src/renderer/pages/text-replacement-page frontend/src/renderer/pages/custom-prompt-page api/Application/V2 api/Server/Routes/V2
git commit -m "refactor: switch remaining runtime endpoints to api v2"
```

### Task 14: 删除 V1 路由、旧 topic 与删旧守卫

**Files:**
- Modify: `api/Server/ServerBootstrap.py`
- Modify: `api/Server/Routes/ProjectRoutes.py`
- Modify: `api/Server/Routes/TaskRoutes.py`
- Modify: `api/Server/Routes/ModelRoutes.py`
- Modify: `api/Server/Routes/WorkbenchRoutes.py`
- Modify: `api/Server/Routes/ProofreadingRoutes.py`
- Modify: `api/Server/Routes/QualityRoutes.py`
- Modify: `api/Server/Routes/EventRoutes.py`
- Modify: `api/Bridge/EventBridge.py`
- Modify: `api/Bridge/EventTopic.py`
- Modify: `api/Client/ApiStateStore.py`
- Modify: `frontend/src/renderer/app/state/desktop-runtime-context.tsx`
- Create: `tests/api/server/test_v1_routes_removed.py`
- Create: `tests/api/bridge/test_v1_topics_removed.py`
- Create: `frontend/src/renderer/app/state/v2/runtime-guard.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `api/SPEC.md`
- Modify: `frontend/SPEC.md`
- Modify: `frontend/src/renderer/SPEC.md`
- Modify: `module/Data/SPEC.md`

- [x] **Step 1: 先写失败守卫，锁住旧路由与旧 topic 不得回流**

```text
必须失败的遗留项：
- `workbench.snapshot_changed`
- `proofreading.snapshot_invalidated`
- V1 project / task / model / workbench / proofreading / quality 路由注册
- renderer 对旧运行时入口的直接监听
```

- [x] **Step 2: 删除 V1 路由注册、旧桥接和旧运行时消费**

```text
删除目标：
- `ServerBootstrap` 中对应 V1 route group 注册
- `EventBridge` / `EventTopic` 中 V1 topic
- `ApiStateStore` 中 V1 invalidation 状态
- 页面与桌面壳层中最后残留的旧监听与旧请求
```

- [x] **Step 3: 跑全套验证，并确认仓库只剩 `/api/v2` 与 `V2` / `v2` 主路径**

Run:

```bash
uv run pytest tests/api tests/module -v
cd frontend
npm run test
npm run lint
npm run renderer:audit
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
Get-ChildItem -Path 'frontend/src/renderer','api' -Recurse -Include *.ts,*.tsx,*.py | Select-String -Pattern 'workbench.snapshot_changed|proofreading.snapshot_invalidated|/api/project/|/api/tasks/|/api/models/|/api/workbench/|/api/proofreading/|/api/quality/'
```

Expected:

```text
测试全绿；扫描结果为空；仓库中的项目运行态主路径只剩 `/api/v2/...` 与 `V2` / `v2` 边界目录
```

- [x] **Step 4: 提交这一小步**

```bash
git add api/Server api/Bridge api/Client frontend/src/renderer/app/state docs/ARCHITECTURE.md api/SPEC.md frontend/SPEC.md frontend/src/renderer/SPEC.md module/Data/SPEC.md tests/api frontend/src/renderer/app/state/v2/runtime-guard.test.ts
git commit -m "refactor: remove v1 runtime protocol and add guards"
```

## 自查清单

### 覆盖核对

- V2 bootstrap stream：Task 2、Task 3、Task 6
- ProjectStore：Task 1、Task 6、Task 7
- mutation / revision / ack：Task 4
- patch / task event：Task 5、Task 11
- Worker 多核计算：Task 8、Task 9、Task 10
- 工作台迁移：Task 7
- 校对页迁移：Task 8、Task 9
- 规则页迁移：Task 10
- 模型页与剩余命令面迁移：Task 13
- V2 路径分轨：Task 12、Task 13
- 删除 V1：Task 14
- 文档同步：Task 11、Task 14

### 风险提醒

1. 若 Task 1 未先落地，后续前端测试任务全部无法执行。
2. 若 Task 4 未先提供 revision/ack，Task 7-Task 10 会陷入“能显示、不能对账”的伪完成状态。
3. 若 Task 8 的 Worker 结果与 `tests/module/test_result_checker.py` 口径不一致，必须先修语义对齐，再推进页面迁移。
4. 若 Task 12 没有先补齐 V2 路由组骨架与替换矩阵，Task 13 到 Task 14 会缺少清晰的迁移落点和删除边界。
5. Task 14 删除 V1 前，必须重新执行 spec 中定义的最低必测场景，并确认扫描守卫为空。
