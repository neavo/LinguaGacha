# frontend-vite 架构与开发规范

## 一句话总览
`frontend-vite` 是 LinguaGacha 的 Electron + React 前端子工程，采用 `src/main`、`src/preload`、`src/renderer` 的标准 `electron-vite` 结构：主进程负责桌面壳层与原生能力，预加载负责安全桥接，渲染层负责页面、导航、状态和样式。

## 目录职责
| 路径 | 职责 |
| --- | --- |
| `package.json` | 子工程命令入口，集中声明 `dev`、`build`、`preview` 与 `ui:audit` 等脚本 |
| `electron.vite.config.ts` | Electron / Vite 统一构建入口，集中声明 main、preload、renderer 的根目录、输出目录与渲染层插件 |
| `electron-builder.json5` | Electron 桌面产物打包配置 |
| `core-api-port-candidates.json` | 预加载默认暴露给渲染层的 Core API 候选端口列表 |
| `scripts/` | 子工程级检查脚本与辅助工具，例如 `check-ui-design-system.mjs` |
| `src/main/` | Electron 主进程；只处理窗口创建、标题栏策略、原生对话框与 IPC 落地 |
| `src/preload/` | `window.desktopApp` 安全桥接；只暴露渲染层必须使用的桌面能力 |
| `src/shared/` | 主进程、预加载与渲染层类型声明共享的桌面契约 |
| `src/renderer/` | React 渲染层入口、页面、导航、状态、共享组件与样式 |
| `public/` | 必须以原始路径暴露给 HTML/Electron 的静态资源，例如 `icon.png` |

## Electron 侧边界
- 主进程入口固定为 `src/main/index.ts`，不要把预加载、页面状态或渲染层工具塞进来。
- 预加载入口固定为 `src/preload/index.ts`，只允许组织 `contextBridge` 暴露对象，不允许在这里写页面状态或业务请求流程。
- IPC channel、桌面壳层信息、标题栏高度和桥接类型统一收敛在 `src/shared/`，按 `ipc-channels.ts`、`desktop-shell.ts` 与 `desktop-types.ts` 拆分，避免主进程、预加载和渲染层类型声明各自维护一套常量。
- Core API 候选地址解析直接内聚在 `src/preload/index.ts`，因为它只服务预加载桥接，没必要再额外拆一个单一消费方文件。

## 渲染层组织规则
### 入口与命名
- 渲染层根目录固定为 `src/renderer/`，`index.html` 与 `index.tsx` 都放在该目录，保持 electron-vite 默认入口约定。
- 应用根组件固定在 `src/renderer/app/index.tsx`，负责组装渲染层 Provider、主题/导航协调逻辑与应用壳层。
- 页面注册表固定在 `src/renderer/app/navigation/screen-registry.ts`，并与 `schema.ts` 同属导航域维护。
- 目录名统一使用 `kebab-case`，例如 `app-settings-page`、`workspace-command-bar`。
- 除约定入口文件外，渲染层源码文件统一使用 `kebab-case`，包括组件文件、hook 文件、context 文件与普通模块文件。
- 页面目录固定以 `page.tsx` 作为入口；`mock.ts`、`types.ts`、`<page-name>.css`、`use-*.ts` 与其他同目录辅助模块按需出现，继续保持语义化命名，不要为了凑整额外造别名。
- 约定后缀文件保留现有后缀语义，例如 `page-scaffold.mock.ts`、`vite-env.d.ts`；这类文件重点是保持后缀可读，而不是强行改成单段命名。

### 分层模型
继续沿用 `app / pages / widgets / ui / i18n / lib` 分层，其中：

| 位置 | 应该放什么 | 不该放什么 |
| --- | --- | --- |
| `src/renderer/app/` | 应用级壳层、导航、主题源、跨页面状态、全局服务与渲染层桌面 API 适配 | 页面局部视觉细节、单页临时状态、一次性业务组件 |
| `src/renderer/ui/` | 设计系统原子与薄封装组件，例如 `Button`、`Card`、`Table`、`Empty`、`ActionBar`；它们负责统一外观、交互基线、无障碍骨架与通用变体 | 页面业务文案、具体页面状态、接口请求、项目/工作台等业务语义 |
| `src/renderer/widgets/` | 跨页面复用的业务部件，由多个 `ui` 组件与少量业务 props 组合而成，例如页头、命令条、导航侧栏 | 只服务单一页面的临时拆分组件；重新定义基础视觉规范的组件 |
| `src/renderer/pages/<page-name>/components/` | 只被当前页面使用的局部业务组件，允许依赖该页面的类型、文案键、状态与样式命名空间 | 被多个页面共享的通用部件；可以沉到 `widgets` 或 `ui` 的通用逻辑 |
| `src/renderer/pages/<page-name>/page.tsx` | 页面装配入口，负责组织页面状态、调用页面级 hooks、拼接本页组件树并导入页面 CSS | 过多视觉细节、可复用组件实现、跨页面共享逻辑 |

#### 落位判断
1. 如果变化主要沉淀统一视觉、交互基线或通用语义骨架，放 `ui/`。
2. 如果离开当前页面后仍成立，并且已经或即将被多个页面消费，放 `widgets/`。
3. 如果它依赖当前页面的状态、文案、样式命名空间或动作，只留在页面目录。
4. 如果还拿不准，先留在最靠近使用点的位置；只有复用边界稳定后，再上提。

#### 依赖方向
- `app/` 可以依赖 `lib/`、`ui/`、`widgets/`、`i18n/`，但不应反向依赖具体页面目录。
- `ui/` 可以依赖 `lib/` 与其他 `ui` 组件，但不要反向依赖 `widgets/` 或 `pages/`。
- `widgets/` 可以依赖 `ui/`、`lib/`、`i18n/`，但不要导入具体页面目录下的实现。
- `pages/<page-name>/components/` 可以依赖 `widgets/` 与 `ui/`，但不要被别的页面反向引用。
- 从页面目录提升组件时，必须同步检查 import 路径、样式命名空间和文档是否仍成立。

### 样式与资源边界
- `src/renderer/index.css` 只负责主题 token、Tailwind / shadcn 全局覆写和跨页面复用规则。
- `src/renderer/app/shell/app-shell.css` 只负责应用壳层、侧栏、工作区和占位骨架等共享布局样式。
- 页面私有样式必须放在页面目录下，由页面入口 `page.tsx` 统一导入；不要让子组件各自导入页面级 CSS。
- 带页面语义的选择器，如 `project-home*`、`workbench-page*`，只能留在对应页面目录的 CSS 文件中。
- `public/` 只放原始静态资源；本地化文案、mock 数据和页面配置属于源码资源，必须留在 `src/renderer/` 内参与构建。

## UI 设计系统
### 一句话目标
把视觉决定权收回到基础组件与全局 token 层，页面层只负责布局、信息密度和语义状态，避免“同样是卡片/按钮却长得不一样”。

### token、主题与全局皮肤
所有 UI 语义 token 统一定义在 [`src/renderer/index.css`](./src/renderer/index.css)。

当前统一使用的语义前缀：

- `--ui-radius-*`
- `--ui-surface-*`
- `--ui-edge-*`
- `--ui-shadow-*`
- `--ui-space-*`
- `--ui-toolbar-*`
- `--ui-table-*`

约束：

- 禁止在页面、部件或业务组件文件里新增 `--ui-*`。
- 新视觉语义必须先进入全局 token，再由基础组件消费。
- 组件主题只能跟随应用根主题源；单个基础组件或适配层不得自行监听 DOM、直接读写 `localStorage`，或维护第二份并行主题状态。

### 第三方基础组件定制门闩
`ui/` 里的 `shadcn` 组件和其他第三方基础组件适配层都视为项目自有源码，但所有定制都必须先判断“这次变化到底属于哪一层”，再决定落点。

#### 判定路径
1. 这次变化是系统级视觉语义，还是单页业务差异？
2. 它影响的是 token、组件骨架/交互、应用级状态机，还是页面布局与文案？
3. 它是在修复一个调用点，还是在建立整个渲染层的统一规则？
4. 如果第二个页面复用这套行为，当前改法是否仍然成立？

只要这四个问题里有任意一个答不清，就不要直接修改 `ui/` 源码或页面 CSS，先把变化归类清楚。

#### 定制优先级
1. 优先改 token、CSS 变量和全局皮肤，把系统级视觉变化收敛到 [`src/renderer/index.css`](./src/renderer/index.css)。
2. 如果现有 `variant`、`size`、`data-slot`、组件组合已经能表达需求，优先复用，不额外改底层实现。
3. 只有在需要统一修改组件骨架、结构语义、交互基线、无障碍行为或全站共享变体时，才直接修改 `src/renderer/ui/`。
4. 只有在变化属于应用级生命周期、异步状态汇聚、伪单例、退场时机、输入归一化等跨页面规则时，才落到 `src/renderer/app/`。
5. 只有在前三层都无法表达，且目标是第三方运行时 DOM、Portal 内容或容器皮肤时，才使用全局覆写。

#### 明确禁止
- 不要把单页文案、局部布局、临时交互直接做进 `ui/` 或全局样式。
- 不要让页面或 `widgets/` 直接调用第三方运行时 API；一旦某类能力已经有统一服务层，页面只能表达业务意图。
- 不要把复杂生命周期规则散落在页面层，例如延迟退场、状态接管、异步任务反馈、单实例协调等，都必须只有一个权威实现。
- 不要为了局部修复而扩大第三方组件暴露面；宁可增加一层应用级适配，也不要让业务页面越来越理解底层实现细节。

### 全局覆写边界
- `index.css` 只接收设计系统全局规则、`data-slot` 级契约、浏览器基础重置，以及第三方组件的全局皮肤覆写。
- `index.css` 中的全局覆写必须同时满足“不依赖具体页面语义”和“不依赖应用壳层布局结构”。
- 页面 CSS 不得直接覆写第三方运行时 DOM、Portal 容器或全局 class。
- 如果一个动画能由 CSS 完整表达，就不要把关键节奏拆成“一半 CSS、一半 TS 内联样式”，避免两套参数源长期漂移。
- 对第三方组件的全局视觉定制，优先追求“骨架不变、皮肤统一、契约清晰”，不要因为一次业务需求回退到大块自定义内容拼装。

### 基础组件职责
#### Card
[`Card`](./src/renderer/ui/card.tsx) 负责：

- 卡片外轮廓
- 表面层级
- 软边界
- 阴影
- 统一 padding 规则

允许变体：

- `default`
- `panel`
- `table`
- `toolbar`

页面层禁止再单独改卡片：

- `background`
- `box-shadow`
- `border-radius`
- `border-color`

#### Button
[`Button`](./src/renderer/ui/button.tsx) 负责：

- 按钮圆角
- 高度
- 内边距
- 基础交互态

当前约定：

- 卡片圆角：`4px`
- 按钮圆角：`8px`
- 工具条按钮使用 `size="toolbar"`

页面层禁止再单独改按钮：

- `border-radius`
- `box-shadow`
- `background`

#### Table
[`Table`](./src/renderer/ui/table.tsx) 负责：

- 表头高度
- 行高
- 分隔线强度
- hover / selected 背景

页面层只保留：

- 列宽
- 对齐方式
- sticky / scroll 等布局能力

#### ActionBar / Toolbar
[`ActionBar`](./src/renderer/ui/action-bar.tsx) 是页面应优先复用的高层动作条组件。  
[`Toolbar`](./src/renderer/ui/toolbar.tsx) 是低层布局原语，仅用于 `ActionBar` 或极少数特殊容器。

`ActionBar` 负责：

- 动作条卡片外观
- 动作按钮分组
- 分隔线左右节奏
- 可选提示文案

`Toolbar` 负责：

- 动作条容器布局
- 动作组间距
- 分隔线高度与透明度
- 提示文案基础样式

页面层优先直接复用 `ActionBar`，只保留响应式方向和特殊布局。

### 页面层边界
业务页面和部件层允许：

- 栅格布局
- 间距组合
- 响应式规则
- 语义色，例如 success / warning 文本

业务页面和部件层禁止：

- 自己定义卡片表面
- 自己定义卡片阴影
- 自己定义按钮圆角
- 自己定义基础表格分隔线强度

### 组件演化规则
- 新组件默认先放最靠近使用点的位置，只有在复用边界已经清晰后再上提。
- 页面组件出现第二个页面消费者时，先评估是否提到 `widgets/`，不要继续跨页面引用页面目录。
- `widgets/` 如果只剩单一页面消费者，且强依赖该页面状态，可以下沉回页面目录，避免形成伪共享层。
- `ui` 只接受设计系统层收益明确的抽象；如果组件名称里已经带明显页面语义，一般不应进入这一层。
- 对 `ui/`、全局样式和应用级服务层的修改默认都要视为“影响整个渲染层”，改动前后都要检查现有消费方是否仍满足统一契约。

### 验证与维护
- 修改 `ui/`、`app/` 中的全局服务，或 `index.css` 里的第三方皮肤时，必须至少回归所有现有消费方，不能只验证当前页面。
- 对运行时全局组件，必须保留一个可交互的调试入口或 playground；后续调整布局、动画、主题或生命周期时，应先在该入口验证，再进入业务页面联调。
- 如果未来需要跟进上游 shadcn 更新，必须通过 `npx shadcn@latest add --dry-run` 与 `--diff` 比对，再决定如何合并本地改动。
- 不要把系统级修改硬塞进外挂 CSS；这会退回到脆弱覆写模式，不符合当前项目对设计系统可维护性的要求。

运行下面的命令检查页面层视觉越权：

```bash
npm run ui:audit
```

当前审查会检查：

- `--ui-*` 是否只在全局 token 文件中定义
- 页面命名空间是否直接改卡片阴影 / 边界 / 圆角
- 工作台表格是否重新定义基础表格分隔线与 hover 视觉

## 改动入口建议
1. 调整 Electron 入口或产物路径时，优先修改 `electron.vite.config.ts`，再同步检查 `package.json` 与 `electron-builder.json5`。
2. 调整桌面桥接接口时，先改 `src/shared/` 下对应的契约模块，再同步 `src/preload/index.ts` 和渲染层消费代码；只在预加载层生效的辅助逻辑则直接留在 `src/preload/`。
3. 调整 Core API 候选地址或桌面端 HTTP 访问策略时，串起来检查 `core-api-port-candidates.json`、`src/preload/index.ts` 与 `src/renderer/app/desktop-api.ts`。
4. 调整主题源、全局通知、跨页面状态、第三方运行时适配或其他应用级服务时，优先改 `src/renderer/app/`，不要把这类规则散落到 `ui/` 或页面目录。
5. 调整导航或页面注册时，优先改 `src/renderer/app/navigation/`，避免把页面注册逻辑散落到壳层组件内。
6. 新增页面时，以 `pages/<page-name>/page.tsx` 为入口，再按需要并置 `<page-name>.css`、`mock.ts`、`types.ts` 或页面私有 hook / 辅助模块，并从导航注册表接入。
