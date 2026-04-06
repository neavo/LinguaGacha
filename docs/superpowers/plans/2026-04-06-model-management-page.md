# Model Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `frontend-vite` 中实现新的模型管理页面与四个关联模态窗口，保留旧版模型管理认知，并将组内排序迁移为拖拽手柄交互。

**Architecture:** React 渲染层新增专属 `model-page` 页面目录，使用单一 `ModelPageSnapshot` 状态源组织四个分类卡片、菜单动作、确认弹窗与四个模态窗口；Core API 继续作为模型配置真相来源，并补充 React 所需的模型测试、可用模型列表与批量重排接口，同时临时兼容旧的 `operation` 排序请求，避免双前端并行期断裂。

**Tech Stack:** Electron + React 18、TypeScript、Radix UI、`@dnd-kit/sortable`、Python Core API、pytest、Ruff

---

> 当前计划遵循用户要求，不包含 git 提交步骤；执行阶段只做本地改动与验证。

## 文件地图

### Core API

- 修改: `api/Application/ModelAppService.py`
  - 承担模型快照、更新、激活、新增、删除、重置、重排，以及新加的“模型测试”“获取可用模型列表” HTTP 入口编排
- 修改: `api/Server/Routes/ModelRoutes.py`
  - 为模型页注册新增的 `list-available` 与 `test` 路由，并保持现有路由集中管理
- 修改: `api/SPEC.md`
  - 更新模型接口契约，明确新端点和重排新旧载荷兼容期
- 修改: `tests/api/application/test_model_app_service.py`
  - 覆盖重排新载荷、模型列表获取、模型测试结果封装
- 修改: `tests/api/client/test_model_api_client.py`
  - 覆盖新增模型 HTTP 路由在真实测试服务器中的请求/响应契约

### 渲染层基础件

- 创建: `frontend-vite/src/renderer/ui/dialog.tsx`
  - 提供可承载大尺寸表单页面的通用模态窗口组件
- 创建: `frontend-vite/src/renderer/ui/textarea.tsx`
  - 提供与现有 `Input` 风格一致的多行输入控件
- 创建: `frontend-vite/src/renderer/ui/slider.tsx`
  - 提供高级设置所需的统一滑条组件

### `model-page` 页面目录

- 创建: `frontend-vite/src/renderer/pages/model-page/types.ts`
  - 维护模型快照、模型条目、分组、对话框状态与请求结果类型
- 创建: `frontend-vite/src/renderer/pages/model-page/use-model-page-state.ts`
  - 管理模型页单一状态源、所有 HTTP 调用、确认弹窗与乐观重排
- 创建: `frontend-vite/src/renderer/pages/model-page/page.tsx`
  - 模型管理页装配入口
- 创建: `frontend-vite/src/renderer/pages/model-page/model-page.css`
  - 页面、分类卡片、flow 列表、模型项与表单模态窗口的私有样式
- 创建: `frontend-vite/src/renderer/pages/model-page/components/model-category-card.tsx`
  - 负责分类头部、品牌色强调条、新增按钮和分类内拖拽容器
- 创建: `frontend-vite/src/renderer/pages/model-page/components/model-item-chip.tsx`
  - 负责拖拽手柄、模型名称按钮与下拉菜单
- 创建: `frontend-vite/src/renderer/pages/model-page/dialogs/model-basic-settings-dialog.tsx`
  - 基础设置模态窗口
- 创建: `frontend-vite/src/renderer/pages/model-page/dialogs/model-task-settings-dialog.tsx`
  - 任务设置模态窗口
- 创建: `frontend-vite/src/renderer/pages/model-page/dialogs/model-advanced-settings-dialog.tsx`
  - 高级设置模态窗口
- 创建: `frontend-vite/src/renderer/pages/model-page/dialogs/model-selector-dialog.tsx`
  - 获取可用模型列表并选择模型标识的模态窗口

### 页面接线与文案

- 修改: `frontend-vite/src/renderer/app/navigation/screen-registry.ts`
  - 用真实 `ModelPage` 取代调试占位页
- 修改: `frontend-vite/src/renderer/i18n/resources/zh-CN/model-page.ts`
  - 补齐模型页与四个弹窗全部文案
- 修改: `frontend-vite/src/renderer/i18n/resources/en-US/model-page.ts`
  - 与中文资源保持同构

## 任务拆解

### Task 1: 扩展模型重排契约，先让 Core API 吃下批量顺序

**Files:**
- Modify: `api/Application/ModelAppService.py`
- Modify: `api/Server/Routes/ModelRoutes.py`
- Modify: `api/SPEC.md`
- Modify: `tests/api/application/test_model_app_service.py`
- Modify: `tests/api/client/test_model_api_client.py`

- [ ] **Step 1: 先写应用服务测试，锁定新重排载荷与兼容行为**

```python
def test_model_app_service_reorder_model_accepts_ordered_model_ids() -> None:
    service = build_model_app_service()

    data = service.reorder_model(
        {
            "ordered_model_ids": ["preset-2", "preset-1"],
        }
    )

    snapshot = data["snapshot"]
    preset_ids = [
        model["id"]
        for model in snapshot["models"]
        if model["type"] == "PRESET"
    ]
    assert preset_ids == ["preset-2", "preset-1"]


def test_model_app_service_reorder_model_keeps_operation_payload_for_legacy_client() -> None:
    service = build_model_app_service()

    data = service.reorder_model(
        {
            "model_id": "preset-2",
            "operation": "MOVE_UP",
        }
    )

    snapshot = data["snapshot"]
    preset_ids = [
        model["id"]
        for model in snapshot["models"]
        if model["type"] == "PRESET"
    ]
    assert preset_ids == ["preset-2", "preset-1"]
```

- [ ] **Step 2: 运行测试，确认当前实现尚未支持新载荷**

Run: `uv run pytest tests/api/application/test_model_app_service.py -k reorder_model -v`

Expected: 至少一个用例失败，错误接近 `ValueError: model not found` 或 `unknown reorder operation`，因为当前实现仍只接受 `model_id + operation`。

- [ ] **Step 3: 在应用服务中加入 `ordered_model_ids` 分支，并保留旧载荷兼容**

```python
def reorder_model(self, request: dict[str, object]) -> dict[str, object]:
    ordered_model_ids_raw = request.get("ordered_model_ids")
    if isinstance(ordered_model_ids_raw, list):
        ordered_model_ids = [
            str(model_id).strip()
            for model_id in ordered_model_ids_raw
            if str(model_id).strip() != ""
        ]
        if not ordered_model_ids:
            raise ValueError("ordered_model_ids is empty")

        config = self.load_config()
        target_model = self.get_model_or_raise(config, ordered_model_ids[0])
        target_type = str(target_model.get("type", ModelType.PRESET.value))
        expected_group_ids = self.collect_group_model_ids(config.models or [], target_type)
        if set(ordered_model_ids) != set(expected_group_ids):
            raise ValueError("ordered_model_ids must match one model group exactly")

        global_order_ids = ModelManager.build_global_ordered_ids_for_group(
            config.models or [],
            target_type,
            ordered_model_ids,
        )
        self.prepare_manager(config)
        self.model_manager.reorder_models(global_order_ids)
        self.sync_config_from_manager(config)
        return self.persist_config_and_build_snapshot(config)

    return self.reorder_model_by_operation(request)
```

- [ ] **Step 4: 调整路由常量与接口文档，让 React 与旧前端都能读懂同一个端点**

```python
class ModelRoutes:
    REORDER_PATH: str = "/api/models/reorder"
```

```md
| `POST` | `/api/models/reorder` | `{"ordered_model_ids": ["..."]}` | `{"snapshot": {...}}` |

说明：旧的 `{"model_id": "...", "operation": "MOVE_UP"}` 仍在双前端并行期临时兼容，`frontend-vite` 统一使用 `ordered_model_ids`。
```

- [ ] **Step 5: 运行后端测试，确认新旧重排语义都成立**

Run: `uv run pytest tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py -k reorder -v`

Expected: PASS，且旧 `operation` 载荷与新 `ordered_model_ids` 载荷都返回最新 `snapshot`。

### Task 2: 补齐“获取可用模型列表”和“测试模型”这两个 React 缺的 Core API 口子

**Files:**
- Modify: `api/Application/ModelAppService.py`
- Modify: `api/Server/Routes/ModelRoutes.py`
- Modify: `api/SPEC.md`
- Modify: `tests/api/application/test_model_app_service.py`
- Modify: `tests/api/client/test_model_api_client.py`

- [ ] **Step 1: 先写应用服务测试，固定新增接口的响应形状**

```python
def test_model_app_service_list_available_models_returns_loader_result() -> None:
    service = build_model_app_service(
        available_models_loader=lambda model: ["gpt-5.4", "gpt-5.4-mini"],
    )

    data = service.list_available_models({"model_id": "preset-1"})

    assert data == {"models": ["gpt-5.4", "gpt-5.4-mini"]}


def test_model_app_service_test_model_returns_runner_result() -> None:
    service = build_model_app_service(
        api_test_runner=lambda model: {
            "success": True,
            "result_msg": "测试通过",
        },
    )

    data = service.test_model({"model_id": "preset-1"})

    assert data["success"] is True
    assert data["result_msg"] == "测试通过"
```

- [ ] **Step 2: 运行测试，确认当前 `ModelAppService` 还没有这些方法**

Run: `uv run pytest tests/api/application/test_model_app_service.py -k "list_available_models or test_model" -v`

Expected: FAIL，错误接近 `AttributeError: 'ModelAppService' object has no attribute ...`。

- [ ] **Step 3: 在 `ModelAppService` 中增加可注入 loader / runner，并暴露两个新方法**

```python
class ModelAppService:
    def __init__(
        self,
        config_loader: Callable[[], ModelConfigLike] | None = None,
        model_manager: ModelManagerLike | None = None,
        available_models_loader: Callable[[dict[str, object]], list[str]] | None = None,
        api_test_runner: Callable[[dict[str, object]], dict[str, object]] | None = None,
    ) -> None:
        self.available_models_loader = (
            available_models_loader
            if available_models_loader is not None
            else self.default_available_models_loader
        )
        self.api_test_runner = (
            api_test_runner
            if api_test_runner is not None
            else self.default_api_test_runner
        )

    def list_available_models(self, request: dict[str, object]) -> dict[str, object]:
        config = self.load_config()
        model = self.get_model_or_raise(config, str(request.get("model_id", "")))
        return {"models": self.available_models_loader(model)}

    def test_model(self, request: dict[str, object]) -> dict[str, object]:
        config = self.load_config()
        model = self.get_model_or_raise(config, str(request.get("model_id", "")))
        return dict(self.api_test_runner(model))
```

- [ ] **Step 4: 注册新路由并更新 HTTP 契约**

```python
class ModelRoutes:
    LIST_AVAILABLE_PATH: str = "/api/models/list-available"
    TEST_PATH: str = "/api/models/test"
```

```python
core_api_server.add_json_route(
    "POST",
    cls.LIST_AVAILABLE_PATH,
    lambda request: ApiResponse(
        ok=True,
        data=model_app_service.list_available_models(request),
    ),
)
core_api_server.add_json_route(
    "POST",
    cls.TEST_PATH,
    lambda request: ApiResponse(
        ok=True,
        data=model_app_service.test_model(request),
    ),
)
```

- [ ] **Step 5: 补一组真实测试服务器契约测试，确保前端 `api_fetch` 可以直接消费**

```python
def test_model_routes_list_available_models_returns_models(
    start_api_server: Callable[..., str],
) -> None:
    service = ModelAppService(
        config_loader=lambda: FakeModelConfig(),
        model_manager=FakeModelManager(),
        available_models_loader=lambda model: ["gpt-5.4", "gpt-5.4-mini"],
    )
    api_client = ApiClient(start_api_server(model_app_service=service))

    payload = api_client.post("/api/models/list-available", {"model_id": "preset-1"})

    assert payload["models"] == ["gpt-5.4", "gpt-5.4-mini"]
```

- [ ] **Step 6: 运行模型 API 测试，确认新增端点已经可用**

Run: `uv run pytest tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py -k "available_models or test_model" -v`

Expected: PASS，新增端点返回稳定 JSON，渲染层可以直接使用 `api_fetch()` 消费。

### Task 3: 先补渲染层基础件与模型页类型，不要让页面层越权拼大模态和多行输入

**Files:**
- Create: `frontend-vite/src/renderer/ui/dialog.tsx`
- Create: `frontend-vite/src/renderer/ui/textarea.tsx`
- Create: `frontend-vite/src/renderer/ui/slider.tsx`
- Create: `frontend-vite/src/renderer/pages/model-page/types.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/zh-CN/model-page.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/en-US/model-page.ts`

- [ ] **Step 1: 写出模型页类型与文案骨架，先锁定后续组件依赖的命名**

```ts
export type ModelType = 'PRESET' | 'CUSTOM_GOOGLE' | 'CUSTOM_OPENAI' | 'CUSTOM_ANTHROPIC'

export type ModelEntrySnapshot = {
  id: string
  type: ModelType
  name: string
  api_format: string
  api_url: string
  api_key: string
  model_id: string
  request: {
    extra_headers: Record<string, string>
    extra_headers_custom_enable: boolean
    extra_body: Record<string, unknown>
    extra_body_custom_enable: boolean
  }
  threshold: {
    input_token_limit: number
    output_token_limit: number
    rpm_limit: number
    concurrency_limit: number
  }
  thinking: {
    level: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH'
  }
  generation: {
    temperature: number
    temperature_custom_enable: boolean
    top_p: number
    top_p_custom_enable: boolean
    presence_penalty: number
    presence_penalty_custom_enable: boolean
    frequency_penalty: number
    frequency_penalty_custom_enable: boolean
  }
}

export type ModelDialogState =
  | { kind: null; model_id: null }
  | { kind: 'basic'; model_id: string }
  | { kind: 'task'; model_id: string }
  | { kind: 'advanced'; model_id: string }
```

```ts
export const zh_cn_model_page = {
  title: '模型管理',
  summary: '把模型分类、激活切换、接口配置和高级参数放回同一处，延续旧版工作流但换成新的页面体系。',
  category: {
    preset: {
      title: '预设模型',
      description: '应用内置的预设模型',
    },
  },
  action: {
    activate: '激活模型',
    basic_settings: '基础设置',
    task_settings: '任务设置',
    advanced_settings: '高级设置',
    delete: '删除模型',
    reset: '重置模型',
    add: '新增',
  },
} as const
```

- [ ] **Step 2: 增加通用大模态、文本域与滑条组件，避免页面层直接拼第三方原语**

```tsx
function DialogContent({
  className,
  size = 'lg',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none',
          'data-[size=lg]:max-w-[960px] data-[size=xl]:max-w-[1120px]',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  )
}
```

```tsx
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-[160px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 3: 运行前端静态检查，先把基础件和资源结构校正到能通过 lint**

Run: `cd frontend-vite && npm run lint`

Expected: PASS；如果报 import 顺序、未使用类型或 JSX 命名问题，先在这一步修干净。

### Task 4: 写模型页状态 hook，把所有 HTTP 动作、确认态和乐观重排收口

**Files:**
- Create: `frontend-vite/src/renderer/pages/model-page/use-model-page-state.ts`
- Modify: `frontend-vite/src/renderer/app/navigation/screen-registry.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/zh-CN/model-page.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/en-US/model-page.ts`

- [ ] **Step 1: 先写状态 hook 骨架，固定对外暴露的最小接口**

```ts
type UseModelPageStateResult = {
  snapshot: ModelPageSnapshot
  grouped_categories: ModelCategorySnapshot[]
  refresh_error: string | null
  is_refreshing: boolean
  readonly: boolean
  dialog_state: ModelDialogState
  confirm_state: ModelConfirmState
  selector_state: ModelSelectorState
  refresh_snapshot: () => Promise<void>
  request_add_model: (model_type: ModelType) => Promise<void>
  request_activate_model: (model_id: string) => Promise<void>
  request_delete_model: (model_id: string) => void
  request_reset_model: (model_id: string) => void
  request_reorder_models: (model_type: ModelType, ordered_model_ids: string[]) => Promise<void>
  update_model_patch: (model_id: string, patch: Record<string, unknown>) => Promise<void>
  open_dialog: (kind: Exclude<ModelDialogState['kind'], null>, model_id: string) => void
  close_dialog: () => void
}
```

- [ ] **Step 2: 用 `api_fetch()` 接通模型快照与所有动作，请求名保持与 Core API 一一对应**

```ts
async function fetch_model_snapshot(): Promise<ModelPageSnapshot> {
  const payload = await api_fetch<{ snapshot?: Partial<ModelPageSnapshot> }>('/api/models/snapshot', {})
  return normalize_model_page_snapshot(payload.snapshot)
}

async function reorder_models(model_type: ModelType, ordered_model_ids: string[]): Promise<ModelPageSnapshot> {
  const payload = await api_fetch<{ snapshot?: Partial<ModelPageSnapshot> }>('/api/models/reorder', {
    ordered_model_ids,
  })
  return normalize_model_page_snapshot(payload.snapshot)
}
```

- [ ] **Step 3: 实现组内乐观重排，并在失败时回退与 toast**

```ts
const request_reorder_models = useCallback(async (
  model_type: ModelType,
  ordered_model_ids: string[],
): Promise<void> => {
  const previous_snapshot = snapshot_ref.current
  const optimistic_snapshot = reorder_snapshot_group(previous_snapshot, model_type, ordered_model_ids)
  set_snapshot(optimistic_snapshot)

  try {
    const next_snapshot = await reorder_models(model_type, ordered_model_ids)
    set_snapshot(next_snapshot)
  } catch (error) {
    set_snapshot(previous_snapshot)
    push_toast('error', t('model_page.feedback.reorder_failed'))
  }
}, [push_toast, t])
```

- [ ] **Step 4: 将 `model` 路由从调试占位切换到真实页面组件**

```ts
import { ModelPage } from '@/pages/model-page/page'

export const SCREEN_REGISTRY: ScreenRegistry = {
  model: {
    component: ModelPage,
    title_key: 'model_page.title',
    summary_key: 'model_page.summary',
  },
}
```

- [ ] **Step 5: 运行 lint，确认 state hook 与路由接线没有类型回退**

Run: `cd frontend-vite && npm run lint`

Expected: PASS；`use-model-page-state.ts` 中不应出现 `any`，也不应把页面状态散到 `page.tsx`。

### Task 5: 实现主页面、分类卡片和 flow 拖拽模型项

**Files:**
- Create: `frontend-vite/src/renderer/pages/model-page/page.tsx`
- Create: `frontend-vite/src/renderer/pages/model-page/model-page.css`
- Create: `frontend-vite/src/renderer/pages/model-page/components/model-category-card.tsx`
- Create: `frontend-vite/src/renderer/pages/model-page/components/model-item-chip.tsx`

- [ ] **Step 1: 先写模型项组件，固定“手柄负责拖拽，按钮负责菜单”的结构**

```tsx
export function ModelItemChip(props: ModelItemChipProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.model.id,
    disabled: props.drag_disabled,
  })

  return (
    <div
      ref={setNodeRef}
      className="model-page__item-chip"
      data-dragging={isDragging ? 'true' : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="model-page__drag-handle"
        aria-label={props.drag_aria_label}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={props.active ? 'brand' : 'outline'} className="model-page__name-trigger">
            {props.model.name}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        {props.menu}
      </DropdownMenu>
    </div>
  )
}
```

- [ ] **Step 2: 写分类卡片组件，内部使用 flow 容器与 `rectSortingStrategy`**

```tsx
<Card className="model-page__category-card">
  <CardContent className="model-page__category-card-content">
    <header className="model-page__category-header">
      <div className="model-page__category-accent" style={{ backgroundColor: props.accent_color }} />
      <div className="model-page__category-copy">
        <h2 className="model-page__category-title" data-ui-text="emphasis">{props.title}</h2>
        <p className="model-page__category-description">{props.description}</p>
      </div>
      {props.add_action}
    </header>

    <DndContext sensors={props.sensors} collisionDetection={closestCenter} onDragEnd={props.on_drag_end}>
      <SortableContext items={props.models.map((model) => model.id)} strategy={rectSortingStrategy}>
        <div className="model-page__flow-list">
          {props.children}
        </div>
      </SortableContext>
    </DndContext>
  </CardContent>
</Card>
```

- [ ] **Step 3: 组装页面入口，把四个分类卡片按固定顺序渲染出来**

```tsx
export function ModelPage(props: ModelPageProps): JSX.Element {
  const model_page_state = useModelPageState()

  return (
    <div
      className="model-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      {model_page_state.grouped_categories.map((category) => (
        <ModelCategoryCard
          key={category.type}
          title={category.title}
          description={category.description}
          accent_color={category.accent_color}
          models={category.models}
          add_action={category.can_add ? (
            <Button variant="outline" onClick={() => void model_page_state.request_add_model(category.type)}>
              <Plus data-icon="inline-start" />
              {t('model_page.action.add')}
            </Button>
          ) : null}
          on_drag_end={(ordered_ids) => {
            void model_page_state.request_reorder_models(category.type, ordered_ids)
          }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 写页面 CSS，严格保持 flow 布局而不是等比分栏 grid**

```css
.model-page__flow-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.model-page__item-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.model-page__name-trigger {
  min-width: 192px;
  justify-content: space-between;
}
```

- [ ] **Step 5: 运行 lint 与 build，确认拖拽与页面接线能完整编译**

Run: `cd frontend-vite && npm run lint && npm run build`

Expected: PASS；`screen-registry.ts` 不再引用模型调试页，模型页能够通过类型检查与构建。

### Task 6: 实现四个模态窗口，并把旧版即时写回逻辑原样迁进新页面

**Files:**
- Create: `frontend-vite/src/renderer/pages/model-page/dialogs/model-basic-settings-dialog.tsx`
- Create: `frontend-vite/src/renderer/pages/model-page/dialogs/model-task-settings-dialog.tsx`
- Create: `frontend-vite/src/renderer/pages/model-page/dialogs/model-advanced-settings-dialog.tsx`
- Create: `frontend-vite/src/renderer/pages/model-page/dialogs/model-selector-dialog.tsx`
- Modify: `frontend-vite/src/renderer/pages/model-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/model-page/use-model-page-state.ts`
- Modify: `frontend-vite/src/renderer/pages/model-page/model-page.css`

- [ ] **Step 1: 先实现基础设置模态窗口，保留名称、地址、密钥、模型标识、思考等级与 `输入/获取/测试` 三按钮**

```tsx
<Dialog open={props.open} onOpenChange={props.onOpenChange}>
  <DialogContent size="lg" className="model-page__dialog-shell">
    <DialogHeader>
      <DialogTitle>{t('model_page.basic_dialog.title')}</DialogTitle>
      <DialogDescription>{t('model_page.basic_dialog.description')}</DialogDescription>
    </DialogHeader>
    <ScrollArea className="model-page__dialog-scroll">
      <div className="model-page__setting-list">
        <SettingCardRow
          title={t('model_page.fields.name.title')}
          description={t('model_page.fields.name.description')}
          action={(
            <Input
              value={props.model.name}
              onChange={(event) => {
                void props.onPatch({ name: event.target.value.trim() })
              }}
            />
          )}
        />
      </div>
    </ScrollArea>
    <DialogFooter>
      <Button onClick={props.onClose}>{t('app.action.close')}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: 实现任务设置与高级设置模态窗口，保持即时写回与 JSON 校验**

```tsx
<SettingCardRow
  title={t('model_page.fields.input_token_limit.title')}
  description={t('model_page.fields.input_token_limit.description')}
  action={(
    <Input
      type="number"
      value={props.model.threshold.input_token_limit}
      onChange={(event) => {
        void props.onPatch({
          threshold: {
            input_token_limit: Number(event.target.value),
          },
        })
      }}
    />
  )}
/>
```

```tsx
<Textarea
  value={headers_text}
  aria-invalid={headers_error || undefined}
  onBlur={() => {
    const parsed = parse_request_json(headers_text)
    if (parsed.ok) {
      void props.onPatch({
        request: {
          extra_headers: parsed.value,
        },
      })
    } else {
      push_toast('warning', t('model_page.feedback.json_format_error'))
    }
  }}
/>
```

- [ ] **Step 3: 实现模型选择模态窗口，接通新接口并保持“点击即写回后关闭”**

```tsx
useEffect(() => {
  if (!props.open) {
    return
  }

  void props.onLoadAvailableModels(props.model.id)
}, [props.model.id, props.onLoadAvailableModels, props.open])

<ScrollArea className="model-page__selector-list">
  {filtered_models.map((model_name) => (
    <button
      key={model_name}
      type="button"
      className="model-page__selector-item"
      onClick={() => {
        void props.onSelectModelId(model_name)
      }}
    >
      {model_name}
    </button>
  ))}
</ScrollArea>
```

- [ ] **Step 4: 在主页面接入四个模态窗口与删除/重置确认弹窗**

```tsx
<ModelBasicSettingsDialog
  open={model_page_state.dialog_state.kind === 'basic'}
  model={model_page_state.active_dialog_model}
  task_busy={model_page_state.readonly}
  onPatch={(patch) => model_page_state.update_model_patch(model_page_state.dialog_state.model_id, patch)}
  onRequestOpenSelector={model_page_state.open_selector_dialog}
  onRequestTestModel={() => void model_page_state.request_test_model(model_page_state.dialog_state.model_id)}
  onClose={model_page_state.close_dialog}
/>
```

- [ ] **Step 5: 运行最终验证命令，并记录手工回归清单**

Run:

```bash
uv run pytest tests/api/application/test_model_app_service.py tests/api/client/test_model_api_client.py -v
cd frontend-vite && npm run lint && npm run build
```

Expected:

- Python 模型 API 用例全部 PASS
- `frontend-vite` lint PASS
- `frontend-vite` build PASS
- 手工回归时确认：
  - 四个分类卡片顺序正确
  - 模型项是 flow 布局
  - 菜单保留旧动作，排序菜单已移除
  - 拖拽只允许组内排序
  - 基础设置、任务设置、高级设置、模型选择四个模态窗口都能完整走通

## 自检

### Spec 覆盖检查

- 主页面四分类卡片: Task 4、Task 5
- 模型项保守迁移与菜单动作: Task 5
- 拖拽手柄 + 组内排序: Task 1、Task 4、Task 5
- 四个模态窗口页面: Task 6
- 旧版文案迁移到 `frontend-vite` i18n: Task 3、Task 4
- 模型测试与可用模型列表接口: Task 2、Task 6
- 错误处理、确认弹窗、忙碌态: Task 4、Task 6
- 接口文档更新: Task 1、Task 2

未发现设计稿中的需求缺口。

### Placeholder 扫描

- 未使用 `TODO`、`TBD`、`之后补`、`类似 Task N` 等占位写法
- 所有新文件路径均已明确
- 所有关键代码步骤都给出了可落地的示例代码

### 类型与命名一致性

- 渲染层统一使用 `ModelPageSnapshot`、`ModelEntrySnapshot`、`ModelDialogState`
- 状态 hook 对外统一使用 `request_*` 与 `update_model_patch`
- 后端新增方法统一命名为 `list_available_models` 与 `test_model`
- 批量重排载荷统一命名为 `ordered_model_ids`

## 执行交接

- 如果选择子代理执行，优先按 Task 1 → Task 6 顺序推进，每个 Task 完成后回到主线程做 review
- 如果选择当前会话内执行，建议先完成 Task 1 和 Task 2，把 Core API 契约补稳，再进入前端基建与页面实现
- 当前计划按用户要求不包含 git 提交步骤；如后续用户改变要求，再单独补整理与提交流程
