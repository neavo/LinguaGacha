# 渲染层规格

## 一句话总览
`src/renderer/` 是 LinguaGacha 的 React 渲染层，采用 `app / pages / widgets / shadcn / hooks / i18n / lib` 分层：`app` 管应用壳层与运行态装配，`pages` 管页面装配与页面私有逻辑，`widgets` 管跨页面复用组合组件，`shadcn` 管基础组件源码，`hooks` / `i18n` / `lib` 提供支撑。

## 阅读顺序
1. 先读本文，确认目录职责、导航映射、页面落位和样式边界。
2. 如果改动涉及 `ProjectStore`、bootstrap、`project.patch` 或变更信号，继续读 [`app/project-runtime/SPEC.md`](./app/project-runtime/SPEC.md)。
3. 如果改动涉及 Electron 壳层、bridge 或构建入口，回到 [`../../SPEC.md`](../../SPEC.md)。

## 目录地图
| 路径 | 职责 |
| --- | --- |
| `app/` | 应用根、导航、壳层组件、桌面运行时上下文、项目运行态装配、跨页面状态 |
| `pages/` | 页面入口、页面私有组件、页面 CSS、页面私有 hook 与辅助模块 |
| `widgets/` | 跨页面复用的组合组件，例如 `app-table`、`command-bar`、`search-bar` |
| `shadcn/` | shadcn CLI 管理的基础组件源码与项目内定制 |
| `hooks/` | 跨页面复用的交互 hook，当前主要是 `use-save-shortcut.ts` |
| `i18n/` | 文案资源、翻译入口、消息类型 |
| `lib/` | 无页面语义的纯逻辑工具 |
| `index.css` | 全局 token、第三方运行时皮肤、浏览器基础重置 |
| `index.tsx` / `index.html` | renderer 启动入口 |

## 真实导航映射
### 路由与屏幕不是一一对应的地方
| 路由 / 节点 | 当前真实落点 | 说明 |
| --- | --- | --- |
| `project-home` | `pages/project-page/page.tsx` | 默认落地页，不在侧边栏分组里显示 |
| `text-replacement` | 仅侧边栏父节点 | 没有独立屏幕；真正页面是 `pre-translation-replacement` / `post-translation-replacement` |
| `custom-prompt` | 仅侧边栏父节点 | 没有独立屏幕；真正页面是 `translation-prompt` / `analysis-prompt` |
| `pre-translation-replacement` / `post-translation-replacement` | 同一个 `TextReplacementPage`，靠 `variant` 区分 | 不要为它们再建平行页面目录 |
| `translation-prompt` / `analysis-prompt` | 同一个 `CustomPromptPage`，靠 `variant` 区分 | 不要为它们再建平行页面目录 |
| `toolbox` | `pages/debug-panel-page/create-debug-panel-screen.tsx` | 当前是 debug panel 工厂生成的屏幕，不存在独立 `toolbox-page/` 目录 |

### 导航权威来源
- `app/navigation/types.ts`：路由 id 常量
- `app/navigation/schema.ts`：侧边栏分组与父子节点结构
- `app/navigation/screen-registry.ts`：路由到具体屏幕组件的映射

修改导航时，必须同时看这三个文件，而不是只改其中一个。

## `app/` 与 `pages/` 的真实边界
### `app/`
- 当前真正承载：
  - `DesktopRuntimeContext`
  - `ProjectStore` 与 V2 运行态装配
  - 应用壳层 `AppSidebar` / `AppTitlebar`
  - 导航 schema 与 screen registry
- 如果一个模块需要：
  - 持有全局上下文
  - 连接 Electron bridge
  - 为多个页面提供统一运行态
  - 只被应用壳层消费
  那它应该留在 `app/`。

### `pages/`
- 每个页面目录固定以 `page.tsx` 为入口。
- 页面目录可以包含：
  - `<page-name>.css`
  - `components/`
  - `types.ts`
  - `use-*.ts`
  - `config.ts` / `merge.ts` / `filtering.ts`
- 页面目录不应该被其他页面反向依赖。

## 状态来源的真实分层
| 状态类型 | 当前权威来源 | 说明 |
| --- | --- | --- |
| 设置、当前工程、当前任务、页面变更信号 | `app/state/desktop-runtime-context.tsx` | 渲染层启动时先做 hydration，再接 SSE |
| 项目运行态最小事实 | `app/project-runtime/` | `ProjectStore` 消费 bootstrap 与 `project.patch` |
| 页面私有筛选、对话框、表格交互状态 | 对应 `pages/*` | 不上提到 `ProjectStore` |
| 文案 | `i18n/resources/*` | 长期文案不写进组件体内 |

## `widgets/` 与 `shadcn/` 的边界
### `widgets/`
- 只放跨页面复用的组合组件层。
- 当前稳定例子：
  - `app-table`
  - `command-bar`
  - `search-bar`
  - `segmented-toggle`
  - `setting-card-row`
  - `progress-toast-ring`

### `shadcn/`
- 只放 shadcn CLI 管理的基础组件源码与其项目内定制。
- `components.json` 中 `aliases.ui` 固定指向 `@/shadcn`，不要把业务组件塞进去污染这层。

## 样式边界
- `index.css` 只处理：
  - `--ui-*` token
  - 第三方运行时全局皮肤
  - 浏览器基础重置
- 页面私有样式必须放在页面目录，由页面入口导入。
- widget 私有样式由 widget 自己导入，不回写到页面 CSS 或 `index.css`。
- 当前渲染层继续执行 `px-first`：
  - 字面量长度优先 `px`
  - `line-height` 用无单位数值
  - `letter-spacing` 仅允许 `em`

## 运行态入口约束
- 渲染层访问 Core API 的唯一入口是 `app/desktop-api.ts`。
- 项目运行态的唯一装配入口是 `app/project-runtime/` 与 `app/state/desktop-runtime-context.tsx`。
- 页面不要重新发明第二套 `/api/v2/events/stream` 或 bootstrap 消费逻辑。

## 验证与维护
涉及渲染层结构、样式边界、导航或基础组件契约的改动，至少运行：

```bash
npm run renderer:audit
npm run lint
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

## 维护约束
- 目录职责优先于“看起来像能复用”；伪共享比轻度重复更糟糕。
- 如果导航结构、页面映射或运行态入口变化，必须同步更新本文。
- 如果某个改动主要影响项目运行态协议，不要只改这里，还要同步更新 [`app/project-runtime/SPEC.md`](./app/project-runtime/SPEC.md)。
