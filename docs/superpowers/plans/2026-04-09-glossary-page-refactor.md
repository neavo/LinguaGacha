# 术语表页重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `frontend-vite` 中实现可正式投入使用的术语表页，并同步沉淀共享的布尔分段开关与表格外壳组件，保持旧版术语表的主要用户认知。

**Architecture:** 术语表页通过 `use-glossary-page-state.ts` 统一收口快照、选择、多选拖拽、搜索、模态编辑与异步动作；页面由常驻搜索条、共享表格外壳承载的主表格、底部动作条和编辑模态页组成。由于 `frontend-vite` 当前没有前端测试运行器，本计划采用“先让消费者引用缺失模块使 `tsc` 失败，再补实现”的编译优先验证法，并强制执行 `npm run lint`、`npm run ui:audit` 与手工回归。

**Tech Stack:** Electron、React 19、TypeScript、Radix UI、lucide-react、@dnd-kit、@tanstack/react-virtual、ESLint、ui:audit

---

### Task 1: 提取统一的 `禁用 | 启用` 分段开关

**Files:**
- Create: `frontend-vite/src/renderer/widgets/boolean-segmented-toggle/boolean-segmented-toggle.tsx`
- Modify: `frontend-vite/src/renderer/i18n/resources/zh-CN/app.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/en-US/app.ts`
- Modify: `frontend-vite/src/renderer/pages/app-settings-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/basic-settings-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/expert-settings-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/model-page/dialogs/model-advanced-settings-dialog.tsx`

- [ ] **Step 1: 先在应用设置页引用缺失的共享开关，让类型检查先失败**

```tsx
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'

<BooleanSegmentedToggle
  aria_label={t('app_settings_page.fields.expert_mode.title')}
  value={app_settings_state.snapshot.expert_mode}
  disabled={app_settings_state.pending_state.expert_mode}
  on_value_change={(next_value) => {
    void app_settings_state.update_expert_mode(next_value)
  }}
/>
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'`

- [ ] **Step 3: 创建共享开关组件，并同步全局开关文案**

```tsx
import { useI18n } from '@/i18n'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

const BOOLEAN_SEGMENTED_VALUES = {
  disabled: 'disabled',
  enabled: 'enabled',
} as const

type BooleanSegmentedToggleProps = {
  aria_label: string
  value: boolean
  disabled?: boolean
  className?: string
  item_class_name?: string
  on_value_change: (next_value: boolean) => void
}

export function BooleanSegmentedToggle(props: BooleanSegmentedToggleProps): JSX.Element {
  const { t } = useI18n()
  const current_value = props.value
    ? BOOLEAN_SEGMENTED_VALUES.enabled
    : BOOLEAN_SEGMENTED_VALUES.disabled

  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      aria-label={props.aria_label}
      className={props.className}
      value={current_value}
      disabled={props.disabled}
      onValueChange={(next_value) => {
        if (next_value === BOOLEAN_SEGMENTED_VALUES.disabled) {
          props.on_value_change(false)
        } else if (next_value === BOOLEAN_SEGMENTED_VALUES.enabled) {
          props.on_value_change(true)
        }
      }}
    >
      <ToggleGroupItem className={props.item_class_name} value={BOOLEAN_SEGMENTED_VALUES.disabled}>
        {t('app.toggle.disabled')}
      </ToggleGroupItem>
      <ToggleGroupItem className={props.item_class_name} value={BOOLEAN_SEGMENTED_VALUES.enabled}>
        {t('app.toggle.enabled')}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
```

```ts
// zh-CN app.ts
toggle: {
  disabled: '禁用',
  enabled: '启用',
},
```

```ts
// en-US app.ts
toggle: {
  disabled: 'Disabled',
  enabled: 'Enabled',
},
```

- [ ] **Step 4: 把现有四个消费者迁移到共享组件**

```tsx
// basic-settings-page/page.tsx
<BooleanSegmentedToggle
  aria_label={t('basic_settings_page.fields.output_folder_open_on_finish.title')}
  value={basic_settings_state.snapshot.output_folder_open_on_finish}
  disabled={basic_settings_state.pending_state.output_folder_open_on_finish}
  className="basic-settings-page__toggle-group"
  item_class_name="basic-settings-page__toggle-item"
  on_value_change={(next_value) => {
    void basic_settings_state.update_output_folder_open_on_finish(next_value)
  }}
/>
```

```tsx
// expert-settings-page/page.tsx
<BooleanSegmentedToggle
  aria_label={t('expert_settings_page.fields.clean_ruby.title')}
  value={expert_settings_state.snapshot.clean_ruby}
  disabled={expert_settings_state.pending_state.clean_ruby}
  className="expert-settings-page__toggle-group"
  item_class_name="expert-settings-page__toggle-item"
  on_value_change={(next_value) => {
    void expert_settings_state.update_clean_ruby(next_value)
  }}
/>
```

```tsx
// model-advanced-settings-dialog.tsx
<BooleanSegmentedToggle
  aria_label={t(field_config.title_key)}
  value={current_enabled}
  disabled={props.readonly}
  className="model-page__advanced-toggle-group"
  item_class_name="model-page__advanced-toggle-item"
  on_value_change={(next_value) => {
    void props.onPatch({
      generation: {
        [field_config.enabled_key]: next_value,
      },
    })
  }}
/>
```

- [ ] **Step 5: 跑类型检查和 Lint，确认统一开关改造通过**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过，无输出

运行：`npm run lint`  
期望：通过，退出码为 `0`

- [ ] **Step 6: 提交这一组共享开关改造**

```bash
git add src/renderer/widgets/boolean-segmented-toggle/boolean-segmented-toggle.tsx \
  src/renderer/i18n/resources/zh-CN/app.ts \
  src/renderer/i18n/resources/en-US/app.ts \
  src/renderer/pages/app-settings-page/page.tsx \
  src/renderer/pages/basic-settings-page/page.tsx \
  src/renderer/pages/expert-settings-page/page.tsx \
  src/renderer/pages/model-page/dialogs/model-advanced-settings-dialog.tsx
git commit -m "feat(frontend-vite): 统一禁用启用分段开关"
```

### Task 2: 提取共享表格外壳并让工作台先接入

**Files:**
- Create: `frontend-vite/src/renderer/widgets/data-table-frame/data-table-frame.tsx`
- Modify: `frontend-vite/src/renderer/pages/workbench-page/components/workbench-file-table.tsx`
- Modify: `frontend-vite/src/renderer/pages/workbench-page/workbench-page.css`

- [ ] **Step 1: 先让工作台表格依赖缺失的共享表格外壳**

```tsx
import { DataTableFrame } from '@/widgets/data-table-frame/data-table-frame'

return (
  <DataTableFrame
    title={t('workbench_page.section.file_list')}
    description={t('workbench_page.empty.description')}
    className="workbench-page__table-card"
    content_class_name="workbench-page__table-card-content"
    empty_state={null}
    header={null}
    body={null}
  />
)
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/widgets/data-table-frame/data-table-frame'`

- [ ] **Step 3: 创建共享表格外壳**

```tsx
import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'

type DataTableFrameProps = {
  title: ReactNode
  description?: ReactNode
  empty_state: ReactNode | null
  header: ReactNode | null
  body: ReactNode | null
  className?: string
  content_class_name?: string
}

export function DataTableFrame(props: DataTableFrameProps): JSX.Element {
  return (
    <Card variant="table" className={props.className}>
      <CardHeader className="sr-only">
        <CardTitle>{props.title}</CardTitle>
        {props.description === undefined ? null : (
          <CardDescription>{props.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className={props.content_class_name}>
        {props.empty_state !== null
          ? props.empty_state
          : (
              <div className="data-table-frame">
                {props.header}
                {props.body}
              </div>
            )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: 把工作台表格的卡片与空态承载迁移到共享外壳**

```tsx
const resolved_empty_state = !props.project_loaded
  ? (
      <div className="workbench-page__empty-wrap">
        <Empty variant="inset" className="workbench-page__empty-state">
          <EmptyHeader>
            <EmptyMedia>
              <ShieldAlert />
            </EmptyMedia>
            <EmptyTitle>{t('workbench_page.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('workbench_page.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  : props.entries.length === 0
    ? (
        <div className="workbench-page__empty-wrap">
          <Empty variant="inset" className="workbench-page__empty-state">
            <EmptyHeader>
              <EmptyMedia>
                <Files />
              </EmptyMedia>
              <EmptyTitle>{t('workbench_page.empty.loaded_title')}</EmptyTitle>
              <EmptyDescription>{t('workbench_page.empty.loaded_description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )
    : null
```

```css
.data-table-frame {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
```

- [ ] **Step 5: 运行编译、Lint 和设计系统门闩**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

运行：`npm run lint`  
期望：通过

运行：`npm run ui:audit`  
期望：通过

- [ ] **Step 6: 提交共享表格外壳与工作台迁移**

```bash
git add src/renderer/widgets/data-table-frame/data-table-frame.tsx \
  src/renderer/pages/workbench-page/components/workbench-file-table.tsx \
  src/renderer/pages/workbench-page/workbench-page.css
git commit -m "feat(frontend-vite): 提取共享表格外壳"
```

### Task 3: 补齐术语表页面入口、桌面文件选择桥接与 i18n 骨架

**Files:**
- Create: `frontend-vite/src/renderer/pages/glossary-page/page.tsx`
- Create: `frontend-vite/src/renderer/pages/glossary-page/types.ts`
- Create: `frontend-vite/src/renderer/pages/glossary-page/glossary-page.css`
- Modify: `frontend-vite/src/renderer/app/navigation/screen-registry.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/zh-CN/glossary-page.ts`
- Modify: `frontend-vite/src/renderer/i18n/resources/en-US/glossary-page.ts`
- Modify: `frontend-vite/src/shared/ipc-channels.ts`
- Modify: `frontend-vite/src/main/index.ts`
- Modify: `frontend-vite/src/preload/index.ts`
- Modify: `frontend-vite/src/electron-env.d.ts`

- [ ] **Step 1: 先把导航注册改成依赖真正的术语表页入口**

```tsx
import { GlossaryPage } from '@/pages/glossary-page/page'

glossary: {
  component: GlossaryPage,
  title_key: 'glossary_page.title',
  summary_key: 'glossary_page.summary',
},
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/pages/glossary-page/page'`

- [ ] **Step 3: 先补桌面桥接和 i18n 结构，给后续状态 hook 留出稳定接口**

```ts
// shared/ipc-channels.ts
export const IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH = 'dialog:pick-glossary-import-file-path'
export const IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH = 'dialog:pick-glossary-export-path'
```

```ts
// preload/index.ts
async pickGlossaryImportFilePath(): Promise<DesktopPathPickResult> {
  return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH)
},
async pickGlossaryExportPath(default_name: string): Promise<DesktopPathPickResult> {
  return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, default_name)
},
```

```ts
// electron-env.d.ts
pickGlossaryImportFilePath: () => Promise<DesktopPathPickResult>
pickGlossaryExportPath: (default_name: string) => Promise<DesktopPathPickResult>
```

```ts
// zh-CN glossary-page.ts
export const zh_cn_glossary_page = {
  title: '术语表',
  summary: '通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能',
  action: {
    create: '新增',
    import: '导入',
    export: '导出',
    statistics: '统计',
    preset: '预设',
    edit: '编辑',
    delete: '删除',
    query: '查询',
    save: '保存',
    cancel: '取消',
  },
  toggle: {
    tooltip: '通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能',
  },
  fields: {
    source: '原文',
    translation: '译文',
    description: '描述',
    rule: '规则',
    status: '状态',
  },
  search: {
    placeholder: '搜索术语表 …',
    previous: '上一个',
    next: '下一个',
    empty: '没有找到匹配项',
  },
  empty: {
    title: '术语表为空',
    description: '点击“新增”创建第一条术语规则，或从文件导入已有术语表。',
  },
} as const
```

- [ ] **Step 4: 创建最小术语表页面骨架，让导航重新可编译**

```tsx
import '@/pages/glossary-page/glossary-page.css'
import type { ScreenComponentProps } from '@/app/navigation/types'

export function GlossaryPage(props: ScreenComponentProps): JSX.Element {
  return (
    <div
      className="glossary-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    />
  )
}
```

```ts
export type GlossaryEntry = {
  src: string
  dst: string
  info: string
  case_sensitive: boolean
}
```

- [ ] **Step 5: 运行编译和 Lint，确认页面入口、桥接与 i18n 骨架完整**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

运行：`npm run lint`  
期望：通过

- [ ] **Step 6: 提交术语表入口、桥接与 i18n 骨架**

```bash
git add src/renderer/pages/glossary-page/page.tsx \
  src/renderer/pages/glossary-page/types.ts \
  src/renderer/pages/glossary-page/glossary-page.css \
  src/renderer/app/navigation/screen-registry.ts \
  src/renderer/i18n/resources/zh-CN/glossary-page.ts \
  src/renderer/i18n/resources/en-US/glossary-page.ts \
  src/shared/ipc-channels.ts \
  src/main/index.ts \
  src/preload/index.ts \
  src/electron-env.d.ts
git commit -m "feat(frontend-vite): 接入术语表页面入口与文件桥接"
```

### Task 4: 增加应用级导航上下文和校对查询意图

**Files:**
- Create: `frontend-vite/src/renderer/app/navigation/navigation-context.tsx`
- Modify: `frontend-vite/src/renderer/app/index.tsx`
- Modify: `frontend-vite/src/renderer/pages/debug-panel-page/page.tsx`

- [ ] **Step 1: 先在 `app/index.tsx` 引入缺失的导航上下文**

```tsx
import { AppNavigationProvider } from '@/app/navigation/navigation-context'

<AppNavigationProvider
  selected_route={selected_route}
  navigate_to_route={handle_select_route}
>
  <ScreenComponent is_sidebar_collapsed={is_sidebar_collapsed} />
</AppNavigationProvider>
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/app/navigation/navigation-context'`

- [ ] **Step 3: 实现导航上下文，并为术语表查询保留校对查询意图**

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import type { RouteId } from '@/app/navigation/types'

export type ProofreadingLookupIntent = {
  keyword: string
  is_regex: boolean
}

type AppNavigationContextValue = {
  selected_route: RouteId
  navigate_to_route: (route_id: RouteId) => void
  proofreading_lookup_intent: ProofreadingLookupIntent | null
  push_proofreading_lookup_intent: (intent: ProofreadingLookupIntent) => void
  clear_proofreading_lookup_intent: () => void
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null)

export function AppNavigationProvider(props: {
  selected_route: RouteId
  navigate_to_route: (route_id: RouteId) => void
  children: ReactNode
}): JSX.Element {
  const [proofreading_lookup_intent, set_proofreading_lookup_intent] = useState<ProofreadingLookupIntent | null>(null)

  const value = useMemo<AppNavigationContextValue>(() => {
    return {
      selected_route: props.selected_route,
      navigate_to_route: props.navigate_to_route,
      proofreading_lookup_intent,
      push_proofreading_lookup_intent: set_proofreading_lookup_intent,
      clear_proofreading_lookup_intent: () => {
        set_proofreading_lookup_intent(null)
      },
    }
  }, [proofreading_lookup_intent, props.navigate_to_route, props.selected_route])

  return (
    <AppNavigationContext.Provider value={value}>
      {props.children}
    </AppNavigationContext.Provider>
  )
}

export function useAppNavigation(): AppNavigationContextValue {
  const value = useContext(AppNavigationContext)
  if (value === null) {
    throw new Error('useAppNavigation must be used inside AppNavigationProvider')
  }
  return value
}
```

- [ ] **Step 4: 让当前占位校对页能显式展示查询意图，保证术语表查询链路可验证**

```tsx
import { useAppNavigation } from '@/app/navigation/navigation-context'

const { proofreading_lookup_intent } = useAppNavigation()

{props.title_key === 'proofreading_page.title' && proofreading_lookup_intent !== null ? (
  <div className="debug-panel-page__meta-row">
    <dt>校对查询意图</dt>
    <dd>
      <code>{JSON.stringify(proofreading_lookup_intent)}</code>
    </dd>
  </div>
) : null}
```

- [ ] **Step 5: 跑编译和 Lint，确认跨页面导航能力可用**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

运行：`npm run lint`  
期望：通过

- [ ] **Step 6: 提交导航上下文与查询意图**

```bash
git add src/renderer/app/navigation/navigation-context.tsx \
  src/renderer/app/index.tsx \
  src/renderer/pages/debug-panel-page/page.tsx
git commit -m "feat(frontend-vite): 增加页面导航上下文"
```

### Task 5: 建立术语表状态 hook 的基础快照、选择、开关与搜索状态

**Files:**
- Modify: `frontend-vite/src/renderer/pages/glossary-page/types.ts`
- Create: `frontend-vite/src/renderer/pages/glossary-page/use-glossary-page-state.ts`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/page.tsx`

- [ ] **Step 1: 让页面入口先依赖缺失的状态 hook**

```tsx
import { useGlossaryPageState } from '@/pages/glossary-page/use-glossary-page-state'

export function GlossaryPage(props: ScreenComponentProps): JSX.Element {
  const glossary_page_state = useGlossaryPageState()

  return (
    <div
      className="glossary-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    />
  )
}
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/pages/glossary-page/use-glossary-page-state'`

- [ ] **Step 3: 先定义稳定类型，再实现状态 hook 的基础骨架**

```ts
export type GlossaryEntryId = string

export type GlossaryDialogMode = 'create' | 'edit'

export type GlossaryDialogState = {
  open: boolean
  mode: GlossaryDialogMode
  target_entry_id: GlossaryEntryId | null
  draft_entry: GlossaryEntry
  dirty: boolean
  saving: boolean
}

export type GlossarySearchState = {
  keyword: string
  matched_entry_ids: GlossaryEntryId[]
  current_match_index: number
}

export type GlossaryStatisticsState = {
  running: boolean
  matched_count_by_entry_id: Record<GlossaryEntryId, number>
  subset_parent_labels_by_entry_id: Record<GlossaryEntryId, string[]>
}

export type GlossaryPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
}
```

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api_fetch } from '@/app/desktop-api'
import type {
  GlossaryDialogState,
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryPresetItem,
  GlossarySearchState,
  GlossaryStatisticsState,
} from '@/pages/glossary-page/types'

type GlossarySnapshotPayload = {
  snapshot: {
    revision: number
    meta: {
      enabled?: boolean
    }
    entries: GlossaryEntry[]
  }
}

const EMPTY_ENTRY: GlossaryEntry = {
  src: '',
  dst: '',
  info: '',
  case_sensitive: false,
}

function build_glossary_entry_id(entry: GlossaryEntry, index: number): GlossaryEntryId {
  return `${entry.src.trim()}::${index}`
}

export function useGlossaryPageState() {
  const [revision, set_revision] = useState(0)
  const [enabled, set_enabled] = useState(true)
  const [entries, set_entries] = useState<GlossaryEntry[]>([])
  const [preset_items, set_preset_items] = useState<GlossaryPresetItem[]>([])
  const [selected_entry_ids, set_selected_entry_ids] = useState<GlossaryEntryId[]>([])
  const [active_entry_id, set_active_entry_id] = useState<GlossaryEntryId | null>(null)
  const [preset_menu_open, set_preset_menu_open] = useState(false)
  const [search_state, set_search_state] = useState<GlossarySearchState>({
    keyword: '',
    matched_entry_ids: [],
    current_match_index: -1,
  })
  const [statistics_state, set_statistics_state] = useState<GlossaryStatisticsState>({
    running: false,
    matched_count_by_entry_id: {},
    subset_parent_labels_by_entry_id: {},
  })
  const [dialog_state, set_dialog_state] = useState<GlossaryDialogState>({
    open: false,
    mode: 'create',
    target_entry_id: null,
    draft_entry: EMPTY_ENTRY,
    dirty: false,
    saving: false,
  })

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    const payload = await api_fetch<GlossarySnapshotPayload>('/api/quality/rules/snapshot', {
      rule_type: 'glossary',
    })
    set_revision(payload.snapshot.revision)
    set_enabled(payload.snapshot.meta.enabled ?? true)
    set_entries(payload.snapshot.entries)
  }, [])

  const save_entries_snapshot = useCallback(async (next_entries: GlossaryEntry[]): Promise<void> => {
    const payload = await api_fetch<GlossarySnapshotPayload>('/api/quality/rules/save-entries', {
      rule_type: 'glossary',
      expected_revision: revision,
      entries: next_entries,
    })
    set_revision(payload.snapshot.revision)
    set_enabled(payload.snapshot.meta.enabled ?? true)
    set_entries(payload.snapshot.entries)
  }, [revision])

  const entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return entries.map((entry, index) => build_glossary_entry_id(entry, index))
  }, [entries])

  const update_search_keyword = useCallback((next_keyword: string): void => {
    const normalized_keyword = next_keyword.trim().toLowerCase()
    const matched_entry_ids = normalized_keyword === ''
      ? []
      : entries.flatMap((entry, index) => {
          const haystack = [entry.src, entry.dst, entry.info].join('\n').toLowerCase()
          return haystack.includes(normalized_keyword)
            ? [build_glossary_entry_id(entry, index)]
            : []
        })
    set_search_state({
      keyword: next_keyword,
      matched_entry_ids,
      current_match_index: matched_entry_ids.length > 0 ? 0 : -1,
    })
  }, [entries])

  const focus_previous_match = useCallback((): void => {
    set_search_state((previous_state) => {
      if (previous_state.matched_entry_ids.length === 0) {
        return previous_state
      }
      const current_match_index = previous_state.current_match_index <= 0
        ? previous_state.matched_entry_ids.length - 1
        : previous_state.current_match_index - 1
      return {
        ...previous_state,
        current_match_index,
      }
    })
  }, [])

  const focus_next_match = useCallback((): void => {
    set_search_state((previous_state) => {
      if (previous_state.matched_entry_ids.length === 0) {
        return previous_state
      }
      const current_match_index = previous_state.current_match_index >= previous_state.matched_entry_ids.length - 1
        ? 0
        : previous_state.current_match_index + 1
      return {
        ...previous_state,
        current_match_index,
      }
    })
  }, [])

  const update_enabled = useCallback(async (next_enabled: boolean): Promise<void> => {
    const payload = await api_fetch<GlossarySnapshotPayload>('/api/quality/rules/update-meta', {
      rule_type: 'glossary',
      expected_revision: revision,
      meta: {
        enabled: next_enabled,
      },
    })
    set_revision(payload.snapshot.revision)
    set_enabled(payload.snapshot.meta.enabled ?? true)
    set_entries(payload.snapshot.entries)
  }, [revision])

  const open_create_dialog = useCallback((): void => {
    set_dialog_state({
      open: true,
      mode: 'create',
      target_entry_id: null,
      draft_entry: EMPTY_ENTRY,
      dirty: false,
      saving: false,
    })
  }, [])

  const open_edit_dialog = useCallback((entry_id: GlossaryEntryId): void => {
    const target_index = entry_ids.indexOf(entry_id)
    const target_entry = target_index < 0 ? null : entries[target_index]
    if (target_entry === null) {
      return
    }
    set_dialog_state({
      open: true,
      mode: 'edit',
      target_entry_id: entry_id,
      draft_entry: target_entry,
      dirty: false,
      saving: false,
    })
  }, [entries, entry_ids])

  const update_dialog_draft = useCallback((patch: Partial<GlossaryEntry>): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        dirty: true,
        draft_entry: {
          ...previous_state.draft_entry,
          ...patch,
        },
      }
    })
  }, [])

  const import_entries_from_picker = useCallback(async (): Promise<void> => {
    const pick_result = await window.desktopApp.pickGlossaryImportFilePath()
    if (pick_result.canceled || pick_result.path === null) {
      return
    }
    const payload = await api_fetch<{ entries: GlossaryEntry[] }>('/api/quality/rules/import', {
      rule_type: 'glossary',
      expected_revision: revision,
      path: pick_result.path,
    })
    set_entries(payload.entries)
  }, [revision])

  const export_entries_from_picker = useCallback(async (): Promise<void> => {
    const pick_result = await window.desktopApp.pickGlossaryExportPath('glossary.json')
    if (pick_result.canceled || pick_result.path === null) {
      return
    }
    await api_fetch('/api/quality/rules/export', {
      rule_type: 'glossary',
      path: pick_result.path,
      entries,
    })
  }, [entries])

  const run_statistics = useCallback(async (): Promise<void> => {
    set_statistics_state((previous_state) => ({ ...previous_state, running: true }))
    const payload = await api_fetch<{ statistics?: Record<string, { matched_item_count?: number }> }>('/api/quality/rules/statistics', {
      rule_type: 'glossary',
      rules: entries.map((entry, index) => ({
        key: build_glossary_entry_id(entry, index),
        pattern: entry.src,
        mode: 'contains',
        regex: false,
        case_sensitive: entry.case_sensitive,
      })),
      relation_candidates: entries.map((entry, index) => ({
        key: build_glossary_entry_id(entry, index),
        src: entry.src,
      })),
    })
    set_statistics_state({
      running: false,
      matched_count_by_entry_id: Object.fromEntries(
        Object.entries(payload.statistics ?? {}).map(([entry_id, result]) => [entry_id, result.matched_item_count ?? 0]),
      ),
      subset_parent_labels_by_entry_id: {},
    })
  }, [entries])

  const open_preset_menu = useCallback(async (): Promise<void> => {
    const payload = await api_fetch<{
      builtin_presets: GlossaryPresetItem[]
      user_presets: GlossaryPresetItem[]
    }>('/api/quality/rules/presets', {
      preset_dir_name: 'glossary',
    })
    set_preset_items([...payload.builtin_presets, ...payload.user_presets])
    set_preset_menu_open(true)
  }, [])

  const apply_preset = useCallback(async (virtual_id: string): Promise<void> => {
    const payload = await api_fetch<{ entries: GlossaryEntry[] }>('/api/quality/rules/presets/read', {
      preset_dir_name: 'glossary',
      virtual_id,
    })
    await save_entries_snapshot(payload.entries)
    set_preset_menu_open(false)
  }, [save_entries_snapshot])

  useEffect(() => {
    void refresh_snapshot()
  }, [refresh_snapshot])

  return {
    revision,
    enabled,
    entries,
    entry_ids,
    preset_items,
    selected_entry_ids,
    active_entry_id,
    preset_menu_open,
    search_state,
    statistics_state,
    dialog_state,
    update_search_keyword,
    focus_previous_match,
    focus_next_match,
    update_enabled,
    open_create_dialog,
    open_edit_dialog,
    update_dialog_draft,
    import_entries_from_picker,
    export_entries_from_picker,
    run_statistics,
    open_preset_menu,
    apply_preset,
    set_selected_entry_ids,
    set_active_entry_id,
    set_search_state,
    set_dialog_state,
    refresh_snapshot,
    save_entries_snapshot,
    set_enabled,
  }
}
```

- [ ] **Step 4: 运行类型检查，确保基础状态结构稳定**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

- [ ] **Step 5: 提交基础状态 hook**

```bash
git add src/renderer/pages/glossary-page/types.ts \
  src/renderer/pages/glossary-page/use-glossary-page-state.ts \
  src/renderer/pages/glossary-page/page.tsx
git commit -m "feat(frontend-vite): 建立术语表状态骨架"
```

### Task 6: 组装术语表页壳层、常驻搜索条和底部动作条

**Files:**
- Create: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-search-bar.tsx`
- Create: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-command-bar.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/glossary-page.css`

- [ ] **Step 1: 先在页面入口引用缺失的搜索条和动作条组件**

```tsx
import { GlossarySearchBar } from '@/pages/glossary-page/components/glossary-search-bar'
import { GlossaryCommandBar } from '@/pages/glossary-page/components/glossary-command-bar'

<GlossarySearchBar
  keyword={glossary_page_state.search_state.keyword}
  on_keyword_change={glossary_page_state.update_search_keyword}
  on_previous_match={glossary_page_state.focus_previous_match}
  on_next_match={glossary_page_state.focus_next_match}
/>
<GlossaryCommandBar
  enabled={glossary_page_state.enabled}
  preset_items={glossary_page_state.preset_items}
  preset_menu_open={glossary_page_state.preset_menu_open}
  on_toggle_enabled={glossary_page_state.update_enabled}
  on_create={glossary_page_state.open_create_dialog}
  on_import={glossary_page_state.import_entries_from_picker}
  on_export={glossary_page_state.export_entries_from_picker}
  on_statistics={glossary_page_state.run_statistics}
  on_open_preset_menu={glossary_page_state.open_preset_menu}
  on_apply_preset={glossary_page_state.apply_preset}
/>
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/pages/glossary-page/components/glossary-search-bar'`

- [ ] **Step 3: 实现常驻搜索条和底部动作条**

```tsx
import { ArrowDown, ArrowUp, Search } from 'lucide-react'

import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { Input } from '@/ui/input'
import { useI18n } from '@/i18n'

type GlossarySearchBarProps = {
  keyword: string
  on_keyword_change: (next_keyword: string) => void
  on_previous_match: () => void
  on_next_match: () => void
}

export function GlossarySearchBar(props: GlossarySearchBarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <Card variant="toolbar" className="glossary-page__search-card">
      <CardContent className="glossary-page__search-card-content">
        <div className="glossary-page__search-bar">
          <Search className="glossary-page__search-icon" />
          <Input
            value={props.keyword}
            className="glossary-page__search-input"
            placeholder={t('glossary_page.search.placeholder')}
            onChange={(event) => {
              props.on_keyword_change(event.target.value)
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={props.on_previous_match}>
            <ArrowUp data-icon="inline-start" />
            {t('glossary_page.search.previous')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={props.on_next_match}>
            <ArrowDown data-icon="inline-start" />
            {t('glossary_page.search.next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

```tsx
import { FileDown, FileUp, FolderOpen, Plus, Sigma } from 'lucide-react'

import { useI18n } from '@/i18n'
import { ActionBar, ActionBarSeparator } from '@/ui/action-bar'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'
import type { GlossaryPresetItem } from '@/pages/glossary-page/types'

export function GlossaryCommandBar(props: {
  enabled: boolean
  preset_items: GlossaryPresetItem[]
  preset_menu_open: boolean
  on_toggle_enabled: (next_value: boolean) => void
  on_create: () => void
  on_import: () => void
  on_export: () => void
  on_statistics: () => void
  on_open_preset_menu: () => void
  on_apply_preset: (virtual_id: string) => Promise<void>
}): JSX.Element {
  const { t } = useI18n()

  return (
    <ActionBar
      title={t('glossary_page.title')}
      description={t('glossary_page.summary')}
      actions={(
        <>
          <Button variant="ghost" size="toolbar" onClick={props.on_create}>
            <Plus data-icon="inline-start" />
            {t('glossary_page.action.create')}
          </Button>
          <ActionBarSeparator />
          <Button variant="ghost" size="toolbar" onClick={props.on_import}>
            <FileDown data-icon="inline-start" />
            {t('glossary_page.action.import')}
          </Button>
          <ActionBarSeparator />
          <Button variant="ghost" size="toolbar" onClick={props.on_export}>
            <FileUp data-icon="inline-start" />
            {t('glossary_page.action.export')}
          </Button>
          <ActionBarSeparator />
          <Button variant="ghost" size="toolbar" onClick={props.on_statistics}>
            <Sigma data-icon="inline-start" />
            {t('glossary_page.action.statistics')}
          </Button>
          <ActionBarSeparator />
          <DropdownMenu
            open={props.preset_menu_open}
            onOpenChange={(next_open) => {
              if (next_open) {
                void props.on_open_preset_menu()
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="toolbar" onClick={props.on_open_preset_menu}>
                <FolderOpen data-icon="inline-start" />
                {t('glossary_page.action.preset')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {props.preset_items.map((item) => (
                <DropdownMenuItem
                  key={item.virtual_id}
                  onClick={() => {
                    void props.on_apply_preset(item.virtual_id)
                  }}
                >
                  {item.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="glossary-page__command-spacer" />
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="glossary-page__toggle-cluster">
                <span className="glossary-page__toggle-title" data-ui-text="emphasis">
                  {t('glossary_page.title')}
                </span>
                <BooleanSegmentedToggle
                  aria_label={t('glossary_page.title')}
                  value={props.enabled}
                  on_value_change={props.on_toggle_enabled}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('glossary_page.toggle.tooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    />
  )
}
```

- [ ] **Step 4: 组装页面壳层并实现 sticky 搜索区**

```tsx
return (
  <div
    className="glossary-page page-shell page-shell--full"
    data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
  >
    <GlossarySearchBar
      keyword={glossary_page_state.search_state.keyword}
      on_keyword_change={glossary_page_state.update_search_keyword}
      on_previous_match={glossary_page_state.focus_previous_match}
      on_next_match={glossary_page_state.focus_next_match}
    />
    <div className="glossary-page__table-host" />
    <GlossaryCommandBar
      enabled={glossary_page_state.enabled}
      preset_items={glossary_page_state.preset_items}
      preset_menu_open={glossary_page_state.preset_menu_open}
      on_toggle_enabled={glossary_page_state.update_enabled}
      on_create={glossary_page_state.open_create_dialog}
      on_import={glossary_page_state.import_entries_from_picker}
      on_export={glossary_page_state.export_entries_from_picker}
      on_statistics={glossary_page_state.run_statistics}
      on_open_preset_menu={glossary_page_state.open_preset_menu}
      on_apply_preset={glossary_page_state.apply_preset}
    />
  </div>
)
```

```css
.glossary-page {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
}

.glossary-page__search-card {
  position: sticky;
  top: 0;
  z-index: 3;
}

.glossary-page__search-card-content {
  padding: 12px;
}

.glossary-page__search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.glossary-page__table-host {
  min-height: 0;
  flex: 1;
}

.glossary-page__toggle-cluster {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
```

- [ ] **Step 5: 跑编译、Lint 和 ui:audit，确认页面壳层成立**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

运行：`npm run lint`  
期望：通过

运行：`npm run ui:audit`  
期望：通过

- [ ] **Step 6: 提交术语表壳层、搜索条和动作条**

```bash
git add src/renderer/pages/glossary-page/page.tsx \
  src/renderer/pages/glossary-page/glossary-page.css \
  src/renderer/pages/glossary-page/components/glossary-search-bar.tsx \
  src/renderer/pages/glossary-page/components/glossary-command-bar.tsx
git commit -m "feat(frontend-vite): 搭建术语表页面壳层"
```

### Task 7: 实现术语表表格、多选、框选、右键菜单与整组拖拽排序

**Files:**
- Create: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-selection.ts`
- Create: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-context-menu.tsx`
- Create: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-table.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/use-glossary-page-state.ts`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/glossary-page.css`

- [ ] **Step 1: 先让页面依赖缺失的表格与上下文菜单组件**

```tsx
import { GlossaryTable } from '@/pages/glossary-page/components/glossary-table'

<GlossaryTable
  entries={glossary_page_state.entries}
  selected_entry_ids={glossary_page_state.selected_entry_ids}
  active_entry_id={glossary_page_state.active_entry_id}
  statistics_state={glossary_page_state.statistics_state}
  on_select_entry={glossary_page_state.select_entry}
  on_select_range={glossary_page_state.select_range}
  on_box_select={glossary_page_state.box_select_entries}
  on_open_edit={glossary_page_state.open_edit_dialog}
  on_delete_selected={glossary_page_state.delete_selected_entries}
  on_toggle_case_sensitive={glossary_page_state.toggle_case_sensitive_for_selected}
  on_reorder={glossary_page_state.reorder_selected_entries}
/>
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/pages/glossary-page/components/glossary-table'`

- [ ] **Step 3: 先把选择与重排逻辑抽成纯函数，给表格和 hook 共用**

```ts
import type { GlossaryEntry, GlossaryEntryId } from '@/pages/glossary-page/types'

export function collect_range_selection(
  ordered_entry_ids: GlossaryEntryId[],
  anchor_entry_id: GlossaryEntryId | null,
  target_entry_id: GlossaryEntryId,
): GlossaryEntryId[] {
  const anchor_index = anchor_entry_id === null ? -1 : ordered_entry_ids.indexOf(anchor_entry_id)
  const target_index = ordered_entry_ids.indexOf(target_entry_id)
  if (target_index < 0) {
    return []
  }
  if (anchor_index < 0) {
    return [target_entry_id]
  }
  const start_index = Math.min(anchor_index, target_index)
  const end_index = Math.max(anchor_index, target_index)
  return ordered_entry_ids.slice(start_index, end_index + 1)
}

export function reorder_selected_group(
  entries: GlossaryEntry[],
  ordered_entry_ids: GlossaryEntryId[],
  selected_entry_ids: GlossaryEntryId[],
  active_entry_id: GlossaryEntryId,
  over_entry_id: GlossaryEntryId,
): GlossaryEntry[] {
  const selected_id_set = new Set(selected_entry_ids.includes(active_entry_id)
    ? selected_entry_ids
    : [active_entry_id])
  const moving_entries = ordered_entry_ids
    .map((entry_id, index) => ({ entry_id, entry: entries[index] }))
    .filter((item) => selected_id_set.has(item.entry_id))
  const remaining_entries = ordered_entry_ids
    .map((entry_id, index) => ({ entry_id, entry: entries[index] }))
    .filter((item) => !selected_id_set.has(item.entry_id))
  const insert_index = remaining_entries.findIndex((item) => item.entry_id === over_entry_id)
  const next_entries = [...remaining_entries]
  const normalized_insert_index = insert_index < 0 ? next_entries.length : insert_index
  next_entries.splice(normalized_insert_index, 0, ...moving_entries)
  return next_entries.map((item) => item.entry)
}
```

- [ ] **Step 4: 实现表格组件，保留旧认知并加入框选与拖拽**

```tsx
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

import { Button } from '@/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/ui/context-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { DataTableFrame } from '@/widgets/data-table-frame/data-table-frame'
import { GlossaryContextMenuContent } from '@/pages/glossary-page/components/glossary-context-menu'

function GlossarySortableRow(props: {
  entry: GlossaryEntry
  entry_id: GlossaryEntryId
  row_index: number
  selected: boolean
  statistics_state: GlossaryStatisticsState
  on_open_edit: (entry_id: GlossaryEntryId) => void
  on_select_entry: (entry_id: GlossaryEntryId, options: { extend: boolean; range: boolean }) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.entry_id })
  const matched_count = props.statistics_state.matched_count_by_entry_id[props.entry_id] ?? 0

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={setNodeRef}
          data-state={props.selected ? 'selected' : undefined}
          style={{ transform: CSS.Transform.toString(transform), transition }}
          onClick={(event) => {
            props.on_select_entry(props.entry_id, {
              extend: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            })
          }}
          onDoubleClick={() => {
            props.on_open_edit(props.entry_id)
          }}
        >
          <TableCell className="glossary-page__drag-cell">
            <Button type="button" variant="ghost" size="icon-sm" {...attributes} {...listeners}>
              <GripVertical />
            </Button>
          </TableCell>
          <TableCell>{props.entry.src}</TableCell>
          <TableCell>{props.entry.dst}</TableCell>
          <TableCell>{props.entry.info}</TableCell>
          <TableCell>{props.entry.case_sensitive ? 'Aa' : ''}</TableCell>
          <TableCell>{matched_count > 0 ? String(matched_count) : ''}</TableCell>
        </TableRow>
      </ContextMenuTrigger>
      <GlossaryContextMenuContent />
    </ContextMenu>
  )
}
```

- [ ] **Step 5: 在 hook 中补齐选择、多选、框选和整组重排状态更新**

```ts
const [selection_anchor_entry_id, set_selection_anchor_entry_id] = useState<GlossaryEntryId | null>(null)

const select_entry = useCallback((entry_id: GlossaryEntryId, options: { extend: boolean; range: boolean }): void => {
  set_active_entry_id(entry_id)
  if (options.range) {
    set_selected_entry_ids(collect_range_selection(entry_ids, selection_anchor_entry_id, entry_id))
    return
  }
  if (options.extend) {
    set_selected_entry_ids((previous_ids) => {
      return previous_ids.includes(entry_id)
        ? previous_ids.filter((current_id) => current_id !== entry_id)
        : [...previous_ids, entry_id]
    })
    set_selection_anchor_entry_id(entry_id)
    return
  }
  set_selected_entry_ids([entry_id])
  set_selection_anchor_entry_id(entry_id)
}, [entry_ids, selection_anchor_entry_id])

const select_range = useCallback((anchor_entry_id: GlossaryEntryId, target_entry_id: GlossaryEntryId): void => {
  set_selected_entry_ids(collect_range_selection(entry_ids, anchor_entry_id, target_entry_id))
  set_active_entry_id(target_entry_id)
  set_selection_anchor_entry_id(anchor_entry_id)
}, [entry_ids])

const box_select_entries = useCallback((next_entry_ids: GlossaryEntryId[]): void => {
  set_selected_entry_ids(next_entry_ids)
  set_active_entry_id(next_entry_ids.at(-1) ?? null)
  set_selection_anchor_entry_id(next_entry_ids[0] ?? null)
}, [])

const delete_selected_entries = useCallback(async (): Promise<void> => {
  const selected_set = new Set(selected_entry_ids)
  const next_entries = entries.filter((_entry, index) => !selected_set.has(entry_ids[index]))
  set_entries(next_entries)
  await save_entries_snapshot(next_entries)
}, [entries, entry_ids, selected_entry_ids, save_entries_snapshot])

const toggle_case_sensitive_for_selected = useCallback(async (next_value: boolean): Promise<void> => {
  const selected_set = new Set(selected_entry_ids)
  const next_entries = entries.map((entry, index) => {
    if (!selected_set.has(entry_ids[index])) {
      return entry
    }
    return {
      ...entry,
      case_sensitive: next_value,
    }
  })
  set_entries(next_entries)
  await save_entries_snapshot(next_entries)
}, [entries, entry_ids, selected_entry_ids, save_entries_snapshot])

const reorder_selected_entries = useCallback(async (active_entry_id: GlossaryEntryId, over_entry_id: GlossaryEntryId): Promise<void> => {
  const next_entries = reorder_selected_group(entries, entry_ids, selected_entry_ids, active_entry_id, over_entry_id)
  set_entries(next_entries)
  await save_entries_snapshot(next_entries)
}, [entries, entry_ids, selected_entry_ids, save_entries_snapshot])

return {
  revision,
  enabled,
  entries,
  entry_ids,
  preset_items,
  selected_entry_ids,
  active_entry_id,
  preset_menu_open,
  search_state,
  statistics_state,
  dialog_state,
  update_search_keyword,
  focus_previous_match,
  focus_next_match,
  update_enabled,
  open_create_dialog,
  open_edit_dialog,
  update_dialog_draft,
  import_entries_from_picker,
  export_entries_from_picker,
  run_statistics,
  open_preset_menu,
  apply_preset,
  select_entry,
  select_range,
  box_select_entries,
  delete_selected_entries,
  toggle_case_sensitive_for_selected,
  reorder_selected_entries,
  set_selected_entry_ids,
  set_active_entry_id,
  set_search_state,
  set_dialog_state,
  refresh_snapshot,
  set_enabled,
}
```

- [ ] **Step 6: 跑编译、Lint 和 ui:audit，确认表格交互层成立**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

运行：`npm run lint`  
期望：通过

运行：`npm run ui:audit`  
期望：通过

- [ ] **Step 7: 提交术语表表格与交互层**

```bash
git add src/renderer/pages/glossary-page/components/glossary-selection.ts \
  src/renderer/pages/glossary-page/components/glossary-context-menu.tsx \
  src/renderer/pages/glossary-page/components/glossary-table.tsx \
  src/renderer/pages/glossary-page/use-glossary-page-state.ts \
  src/renderer/pages/glossary-page/page.tsx \
  src/renderer/pages/glossary-page/glossary-page.css
git commit -m "feat(frontend-vite): 实现术语表表格交互"
```

### Task 8: 实现编辑模态页、未保存保护、导入导出、统计、预设和查询链路

**Files:**
- Create: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-edit-dialog.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/use-glossary-page-state.ts`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/page.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-command-bar.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/components/glossary-context-menu.tsx`
- Modify: `frontend-vite/src/renderer/pages/glossary-page/glossary-page.css`

- [ ] **Step 1: 先让页面入口依赖缺失的编辑模态页**

```tsx
import { GlossaryEditDialog } from '@/pages/glossary-page/components/glossary-edit-dialog'

<GlossaryEditDialog
  open={glossary_page_state.dialog_state.open}
  mode={glossary_page_state.dialog_state.mode}
  entry={glossary_page_state.dialog_state.draft_entry}
  dirty={glossary_page_state.dialog_state.dirty}
  saving={glossary_page_state.dialog_state.saving}
  on_change={glossary_page_state.update_dialog_draft}
  on_save={glossary_page_state.save_dialog_entry}
  on_delete={glossary_page_state.delete_dialog_entry}
  on_query={glossary_page_state.query_dialog_entry}
  on_close={glossary_page_state.request_close_dialog}
/>
```

- [ ] **Step 2: 运行编译检查，确认当前会失败**

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：失败，报错包含 `Cannot find module '@/pages/glossary-page/components/glossary-edit-dialog'`

- [ ] **Step 3: 实现编辑模态页 UI，保留旧字段与按钮语义**

```tsx
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'
import { useI18n } from '@/i18n'
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'

export function GlossaryEditDialog(props: {
  open: boolean
  mode: 'create' | 'edit'
  entry: GlossaryEntry
  dirty: boolean
  saving: boolean
  on_change: (patch: Partial<GlossaryEntry>) => void
  on_save: () => Promise<void>
  on_delete: () => Promise<void>
  on_query: () => Promise<void>
  on_close: () => Promise<void>
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          void props.on_close()
        }
      }}
    >
      <DialogContent size="lg" onPointerDownOutside={(event) => event.preventDefault()}>
        <div className="glossary-page__dialog-body">
          <Input
            value={props.entry.src}
            placeholder={t('glossary_page.fields.source')}
            onChange={(event) => {
              props.on_change({ src: event.target.value })
            }}
          />
          <Input
            value={props.entry.dst}
            placeholder={t('glossary_page.fields.translation')}
            onChange={(event) => {
              props.on_change({ dst: event.target.value })
            }}
          />
          <Textarea
            value={props.entry.info}
            placeholder={t('glossary_page.fields.description')}
            onChange={(event) => {
              props.on_change({ info: event.target.value })
            }}
          />
          <BooleanSegmentedToggle
            aria_label={t('glossary_page.fields.rule')}
            value={props.entry.case_sensitive}
            on_value_change={(next_value) => {
              props.on_change({ case_sensitive: next_value })
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { void props.on_query() }}>
            {t('glossary_page.action.query')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => { void props.on_delete() }}>
            {t('glossary_page.action.delete')}
          </Button>
          <Button type="button" variant="outline" onClick={() => { void props.on_close() }}>
            {t('glossary_page.action.cancel')}
          </Button>
          <Button type="button" onClick={() => { void props.on_save() }}>
            {t('glossary_page.action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: 在状态 hook 中补齐保存、删除、查询、导入导出、统计、预设与自动保存关闭**

```ts
const update_enabled = useCallback(async (next_enabled: boolean): Promise<void> => {
  const payload = await api_fetch<GlossarySnapshotPayload>('/api/quality/rules/update-meta', {
    rule_type: 'glossary',
    expected_revision: revision,
    meta: {
      enabled: next_enabled,
    },
  })
  set_revision(payload.snapshot.revision)
  set_enabled(payload.snapshot.meta.enabled ?? true)
  set_entries(payload.snapshot.entries)
}, [revision])

const save_dialog_entry = useCallback(async (): Promise<void> => {
  const normalized_entry: GlossaryEntry = {
    src: dialog_state.draft_entry.src.trim(),
    dst: dialog_state.draft_entry.dst.trim(),
    info: dialog_state.draft_entry.info.trim(),
    case_sensitive: dialog_state.draft_entry.case_sensitive,
  }
  const next_entries = dialog_state.mode === 'create'
    ? active_entry_id === null
      ? [...entries, normalized_entry]
      : (() => {
          const insert_index = entry_ids.indexOf(active_entry_id)
          const resolved_insert_index = insert_index < 0 ? entries.length : insert_index + 1
          const cloned_entries = [...entries]
          cloned_entries.splice(resolved_insert_index, 0, normalized_entry)
          return cloned_entries
        })()
    : entries.map((entry, index) => {
        return entry_ids[index] === dialog_state.target_entry_id
          ? normalized_entry
          : entry
      })
  await save_entries_snapshot(next_entries)
  set_dialog_state((previous_state) => ({
    ...previous_state,
    open: false,
    dirty: false,
    saving: false,
  }))
}, [active_entry_id, dialog_state, entries, entry_ids, save_entries_snapshot])

const request_close_dialog = useCallback(async (): Promise<void> => {
  if (!dialog_state.dirty) {
    set_dialog_state((previous_state) => ({ ...previous_state, open: false }))
    return
  }
  await save_dialog_entry()
}, [dialog_state.dirty, save_dialog_entry])

const query_dialog_entry = useCallback(async (): Promise<void> => {
  const payload = await api_fetch<{ query: { keyword: string; is_regex: boolean } }>('/api/quality/rules/query-proofreading', {
    rule_type: 'glossary',
    entry: dialog_state.draft_entry,
  })
  push_proofreading_lookup_intent(payload.query)
  navigate_to_route('proofreading')
}, [dialog_state.draft_entry, navigate_to_route, push_proofreading_lookup_intent])

const delete_dialog_entry = useCallback(async (): Promise<void> => {
  if (dialog_state.mode === 'create') {
    set_dialog_state((previous_state) => ({ ...previous_state, open: false, dirty: false }))
    return
  }
  const next_entries = entries.filter((_entry, index) => entry_ids[index] !== dialog_state.target_entry_id)
  await save_entries_snapshot(next_entries)
  set_dialog_state((previous_state) => ({ ...previous_state, open: false, dirty: false }))
}, [dialog_state.mode, dialog_state.target_entry_id, entries, entry_ids, save_entries_snapshot])

const import_entries_from_picker = useCallback(async (): Promise<void> => {
  const pick_result = await window.desktopApp.pickGlossaryImportFilePath()
  if (pick_result.canceled || pick_result.path === null) {
    return
  }
  const payload = await api_fetch<{ entries: GlossaryEntry[] }>('/api/quality/rules/import', {
    rule_type: 'glossary',
    expected_revision: revision,
    path: pick_result.path,
  })
  await save_entries_snapshot(payload.entries)
}, [revision, save_entries_snapshot])

const export_entries_from_picker = useCallback(async (): Promise<void> => {
  const pick_result = await window.desktopApp.pickGlossaryExportPath('glossary.json')
  if (pick_result.canceled || pick_result.path === null) {
    return
  }
  await api_fetch('/api/quality/rules/export', {
    rule_type: 'glossary',
    path: pick_result.path,
    entries,
  })
}, [entries])

return {
  revision,
  enabled,
  entries,
  entry_ids,
  preset_items,
  selected_entry_ids,
  active_entry_id,
  preset_menu_open,
  search_state,
  statistics_state,
  dialog_state,
  update_search_keyword,
  focus_previous_match,
  focus_next_match,
  update_enabled,
  open_create_dialog,
  open_edit_dialog,
  update_dialog_draft,
  import_entries_from_picker,
  export_entries_from_picker,
  run_statistics,
  open_preset_menu,
  apply_preset,
  select_entry,
  select_range,
  box_select_entries,
  delete_selected_entries,
  toggle_case_sensitive_for_selected,
  reorder_selected_entries,
  set_selected_entry_ids,
  set_active_entry_id,
  set_search_state,
  set_dialog_state,
  refresh_snapshot,
  save_entries_snapshot,
  set_enabled,
  save_dialog_entry,
  request_close_dialog,
  query_dialog_entry,
  delete_dialog_entry,
}
```

- [ ] **Step 5: 把模态页接回页面，并完成最终验证**

```tsx
<GlossaryTable
  entries={glossary_page_state.entries}
  selected_entry_ids={glossary_page_state.selected_entry_ids}
  active_entry_id={glossary_page_state.active_entry_id}
  statistics_state={glossary_page_state.statistics_state}
  on_select_entry={glossary_page_state.select_entry}
  on_select_range={glossary_page_state.select_range}
  on_box_select={glossary_page_state.box_select_entries}
  on_open_edit={glossary_page_state.open_edit_dialog}
  on_delete_selected={glossary_page_state.delete_selected_entries}
  on_toggle_case_sensitive={glossary_page_state.toggle_case_sensitive_for_selected}
  on_reorder={glossary_page_state.reorder_selected_entries}
/>
<GlossaryEditDialog
  open={glossary_page_state.dialog_state.open}
  mode={glossary_page_state.dialog_state.mode}
  entry={glossary_page_state.dialog_state.draft_entry}
  dirty={glossary_page_state.dialog_state.dirty}
  saving={glossary_page_state.dialog_state.saving}
  on_change={glossary_page_state.update_dialog_draft}
  on_save={glossary_page_state.save_dialog_entry}
  on_delete={glossary_page_state.delete_dialog_entry}
  on_query={glossary_page_state.query_dialog_entry}
  on_close={glossary_page_state.request_close_dialog}
/>
```

运行：`npx tsc -p tsconfig.json --noEmit`  
期望：通过

运行：`npm run lint`  
期望：通过

运行：`npm run ui:audit`  
期望：通过

- [ ] **Step 6: 按手工清单回归术语表和受影响页面**

运行清单：

1. 打开术语表页，确认页面不再显示头部说明卡。
2. 搜索条默认可见，滚动时保持 sticky。
3. 单击、多选、`Ctrl / Shift`、框选同时可用。
4. 右键菜单包含 `编辑`、`删除`、`大小写敏感 -> 启用 / 禁用`。
5. 双击、右键 `编辑`、动作条 `新增` 都能打开模态页。
6. 模态页点击遮罩不会关闭，`取消` / 右上角关闭 / `Esc` 都走自动保存保护。
7. 多选后拖动任意选中项时，整组一起移动并保持相对顺序。
8. `查询` 会跳到校对页，并在当前占位校对页中看到查询意图回显。
9. 导入导出对话框仅允许 `json/xlsx`。
10. `app-settings`、`basic-settings`、`expert-settings`、`model-advanced-settings-dialog` 中全部使用 `禁用 / 启用`。
11. 工作台表格在共享外壳上仍保持虚拟化和拖拽行为。

- [ ] **Step 7: 提交术语表整体验收版**

```bash
git add src/renderer/pages/glossary-page \
  src/renderer/app/navigation/navigation-context.tsx \
  src/renderer/app/index.tsx \
  src/renderer/pages/debug-panel-page/page.tsx \
  src/shared/ipc-channels.ts \
  src/main/index.ts \
  src/preload/index.ts \
  src/electron-env.d.ts \
  src/renderer/i18n/resources/zh-CN/glossary-page.ts \
  src/renderer/i18n/resources/en-US/glossary-page.ts
git commit -m "feat(frontend-vite): 实现术语表页面"
```

---

## 自检

### 规格覆盖

- 常驻搜索：Task 6、Task 8
- 标题并入动作条右侧总开关：Task 6
- `禁用 | 启用` 全局统一：Task 1
- 共享表格外壳：Task 2
- 术语表真实页面替换占位页：Task 3
- 多选、框选、整组拖拽排序：Task 7
- 右键 `编辑`：Task 7
- 模态编辑、自动保存关闭、`取消` 按钮：Task 8
- 导入导出、统计、预设：Task 8
- 查询跳校对页：Task 4、Task 8

未发现遗漏项。

### 占位符扫描

- 计划中未使用 `TODO`、`TBD`、`类似 Task N`、`后续补充` 等占位语句。
- 每个任务都给出了明确的文件路径、代码片段、命令和期望结果。

### 命名一致性

- 共享布尔开关统一使用 `BooleanSegmentedToggle`
- 共享表格外壳统一使用 `DataTableFrame`
- 术语表状态 hook 统一使用 `useGlossaryPageState`
- 查询导航上下文统一使用 `useAppNavigation`

---

## 执行提示

- 所有代码命令都在 `E:/Project/LinguaGacha/frontend-vite` 目录运行。
- 本计划默认包含频繁提交步骤；如果执行时你希望改成“只在大阶段提交一次”，可以在开始实施前统一调整。

## 先读这些文件

- 规格文档：`E:/Project/LinguaGacha/docs/superpowers/specs/2026-04-09-glossary-page-design.md`
- 渲染层规范：`E:/Project/LinguaGacha/frontend-vite/SPEC.md`
- 旧版术语表：`E:/Project/LinguaGacha/frontend/Quality/GlossaryPage.py`
- 旧版规则页基类：`E:/Project/LinguaGacha/frontend/Quality/QualityRulePageBase.py`
- 工作台表格：`E:/Project/LinguaGacha/frontend-vite/src/renderer/pages/workbench-page/components/workbench-file-table.tsx`
- 现有布尔分段开关消费者：
  - `E:/Project/LinguaGacha/frontend-vite/src/renderer/pages/app-settings-page/page.tsx`
  - `E:/Project/LinguaGacha/frontend-vite/src/renderer/pages/basic-settings-page/page.tsx`
  - `E:/Project/LinguaGacha/frontend-vite/src/renderer/pages/expert-settings-page/page.tsx`
  - `E:/Project/LinguaGacha/frontend-vite/src/renderer/pages/model-page/dialogs/model-advanced-settings-dialog.tsx`

## 文件结构锁定

### 新增文件

- `frontend-vite/src/renderer/widgets/boolean-segmented-toggle/boolean-segmented-toggle.tsx`
  - 统一 `禁用 | 启用` 双段按钮组，不承载业务保存逻辑。
- `frontend-vite/src/renderer/widgets/data-table-frame/data-table-frame.tsx`
  - 共享表格外壳，负责卡片容器、头体结构、滚动区和空态承载。
- `frontend-vite/src/renderer/app/navigation/navigation-context.tsx`
  - 暴露跨页面路由切换和校对查询意图。
- `frontend-vite/src/renderer/pages/glossary-page/page.tsx`
  - 术语表页面入口。
- `frontend-vite/src/renderer/pages/glossary-page/types.ts`
  - 术语表条目、模态、搜索、统计、选择等类型。
- `frontend-vite/src/renderer/pages/glossary-page/use-glossary-page-state.ts`
  - 术语表页唯一权威状态源。
- `frontend-vite/src/renderer/pages/glossary-page/glossary-page.css`
  - 页面私有样式。
- `frontend-vite/src/renderer/pages/glossary-page/components/glossary-search-bar.tsx`
  - 常驻搜索条。
- `frontend-vite/src/renderer/pages/glossary-page/components/glossary-command-bar.tsx`
  - 底部动作条与右侧复合总开关。
- `frontend-vite/src/renderer/pages/glossary-page/components/glossary-context-menu.tsx`
  - 右键菜单内容。
- `frontend-vite/src/renderer/pages/glossary-page/components/glossary-table.tsx`
  - 主表格、多选、框选、拖拽排序、上下文菜单与双击编辑。
- `frontend-vite/src/renderer/pages/glossary-page/components/glossary-selection.ts`
  - 选择与拖拽相关的纯函数工具。
- `frontend-vite/src/renderer/pages/glossary-page/components/glossary-edit-dialog.tsx`
  - 编辑模态页。

### 修改文件

- `frontend-vite/src/renderer/i18n/resources/zh-CN/app.ts`
- `frontend-vite/src/renderer/i18n/resources/en-US/app.ts`
- `frontend-vite/src/renderer/pages/app-settings-page/page.tsx`
- `frontend-vite/src/renderer/pages/basic-settings-page/page.tsx`
- `frontend-vite/src/renderer/pages/expert-settings-page/page.tsx`
- `frontend-vite/src/renderer/pages/model-page/dialogs/model-advanced-settings-dialog.tsx`
- `frontend-vite/src/renderer/pages/workbench-page/components/workbench-file-table.tsx`
- `frontend-vite/src/renderer/pages/workbench-page/workbench-page.css`
- `frontend-vite/src/renderer/app/navigation/screen-registry.ts`
- `frontend-vite/src/renderer/app/index.tsx`
- `frontend-vite/src/renderer/pages/debug-panel-page/page.tsx`
- `frontend-vite/src/renderer/i18n/resources/zh-CN/glossary-page.ts`
- `frontend-vite/src/renderer/i18n/resources/en-US/glossary-page.ts`
- `frontend-vite/src/shared/ipc-channels.ts`
- `frontend-vite/src/main/index.ts`
- `frontend-vite/src/preload/index.ts`
- `frontend-vite/src/electron-env.d.ts`

### 验证命令

以下命令均在 `E:/Project/LinguaGacha/frontend-vite` 目录运行：

- `npx tsc -p tsconfig.json --noEmit`
- `npm run lint`
- `npm run ui:audit`

---
