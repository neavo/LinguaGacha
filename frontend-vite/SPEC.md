# frontend-vite 结构说明

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

## Electron 侧约束
- 主进程入口固定为 `src/main/index.ts`，不要把预加载、页面状态或渲染层工具塞进来。
- 预加载入口固定为 `src/preload/index.ts`，只允许组织 `contextBridge` 暴露对象，不允许在这里写页面状态或业务请求流程。
- IPC channel、桌面壳层信息、标题栏高度和桥接类型统一收敛在 `src/shared/`，按 `ipc-channels.ts`、`desktop-shell.ts` 与 `desktop-types.ts` 拆分，避免主进程、预加载和渲染层类型声明各自维护一套常量。
- Core API 候选地址解析直接内聚在 `src/preload/index.ts`，因为它只服务预加载桥接，没必要再额外拆一个单一消费方文件。

## 渲染层约束
- 渲染层根目录固定为 `src/renderer/`，`index.html` 与 `index.tsx` 都放在该目录，保持 electron-vite 默认入口约定。
- 应用根组件固定在 `src/renderer/app/index.tsx`，负责组装渲染层 Provider、主题/导航协调逻辑与应用壳层。
- 页面注册表固定在 `src/renderer/app/navigation/screen-registry.ts`，并与 `schema.ts` 同属导航域维护。
- 继续沿用 `app / pages / widgets / ui / i18n / lib` 分层：`app` 放应用级壳层、导航与渲染层桌面 API 适配，`pages` 放页面入口，`widgets` 放跨页面业务组件，`ui` 放基础 UI 组件。
- 页面私有样式必须放在页面目录下，由页面入口 `page.tsx` 统一导入；不要让子组件各自导入页面级 CSS。

## 渲染层命名约定
- 目录名统一使用 `kebab-case`，例如 `app-settings-page`、`workspace-command-bar`。
- 除约定入口文件外，渲染层源码文件统一使用 `kebab-case`，包括组件文件、hook 文件、context 文件与普通模块文件。
- 页面目录固定以 `page.tsx` 作为入口；`mock.ts`、`types.ts`、`<page-name>.css`、`use-*.ts` 与其他同目录辅助模块按需出现，继续保持语义化命名，不要为了凑整额外造别名。
- 约定后缀文件保留现有后缀语义，例如 `page-scaffold.mock.ts`、`vite-env.d.ts`；这类文件重点是保持后缀可读，而不是强行改成单段命名。

## 渲染层分层判定
| 位置 | 应该放什么 | 不该放什么 |
| --- | --- | --- |
| `src/renderer/ui/` | 设计系统原子与薄封装组件，例如 `Button`、`Card`、`Table`、`Empty`、`ActionBar`；它们负责统一外观、交互基线、无障碍骨架与通用变体 | 页面业务文案、具体页面状态、接口请求、项目/工作台等业务语义 |
| `src/renderer/widgets/` | 跨页面复用的业务部件，由多个 `ui` 组件与少量业务 props 组合而成，例如页头、命令条、导航侧栏 | 只服务单一页面的临时拆分组件；重新定义基础视觉规范的组件 |
| `src/renderer/pages/<page-name>/components/` | 只被当前页面使用的局部业务组件，允许依赖该页面的类型、文案键、状态与样式命名空间 | 被多个页面共享的通用部件；可以沉到 `widgets` 或 `ui` 的通用逻辑 |
| `src/renderer/pages/<page-name>/page.tsx` | 页面装配入口，负责组织页面状态、调用页面级 hooks、拼接本页组件树并导入页面 CSS | 过多视觉细节、可复用组件实现、跨页面共享逻辑 |

判定顺序：

1. 如果组件的价值主要来自统一视觉、交互基线或通用组合语义，就放 `ui/`。
2. 如果组件脱离某个页面后仍然成立，并且已有至少两个页面会复用，就放 `widgets/`。
3. 如果组件强依赖某个页面的状态、文案、命名空间 CSS 或业务动作，就留在 `pages/<page-name>/components/`。
4. 如果还拿不准，先留在页面目录；只有在第二个消费方出现后，再上提到 `widgets/` 或 `ui/`。

额外约束：

- `ui/` 可以依赖 `lib/` 与其他 `ui` 组件，但不要反向依赖 `widgets/` 或 `pages/`。
- `widgets/` 可以依赖 `ui/`、`lib/`、`i18n/`，但不要导入具体页面目录下的实现。
- `pages/<page-name>/components/` 可以依赖 `widgets/` 与 `ui/`，但不要被别的页面反向引用。
- 从页面目录提升组件时，必须同时检查 import 路径、样式命名空间和文档是否仍然成立。

## 样式与资源约束
- `src/renderer/index.css` 只负责主题 token、Tailwind / shadcn 全局覆写和跨页面复用规则。
- `src/renderer/app/shell/app-shell.css` 只负责应用壳层、侧栏、工作区和占位骨架等共享布局样式。
- 带页面语义的选择器，如 `project-home*`、`workbench-page*`，只能留在对应页面目录的 CSS 文件中。
- `public/` 只放原始静态资源；本地化文案、mock 数据和页面配置属于源码资源，必须留在 `src/renderer/` 内参与构建。

## UI 设计系统
### 一句话目标
把视觉决定权收回到基础组件与全局 token 层，页面层只负责布局、信息密度和语义状态，避免“同样是卡片/按钮却长得不一样”。

### 全局 token
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

- 禁止在页面、部件或业务组件文件里新增 `--ui-*`
- 新视觉语义必须先进入全局 token，再由基础组件消费

### shadcn 定制门闩
`ui/` 里的 shadcn 组件不是“不可触碰的 vendor 文件”，而是项目自有源码。允许直接修改，但必须按下面的优先级与边界执行，避免把设计系统、组件骨架和全局覆写混成一团。

定制优先级：

1. 优先改全局 token、CSS 变量和语义色，把颜色、圆角、阴影、间距等系统级变化收敛到 [`src/renderer/index.css`](./src/renderer/index.css)。
2. 如果现有 `variant`、`size`、`data-slot` 组合已经能表达需求，优先复用组件能力，不要额外改底层实现。
3. 只有在需要统一修改组件骨架、结构语义、交互基线、无障碍行为或全站共享变体时，才直接改 `ui/` 源码。
4. 只有在目标是第三方运行时 DOM、Portal 内容或组件外部容器，且无法通过 token 或 `ui/` 收口时，才使用全局覆写。

允许直接修改 `ui/` 的场景：

- 需要新增全站共享的 `variant`、`size`、`data-slot` 或通用 props。
- 需要统一调整 DOM 结构、无障碍语义、交互行为或默认组合方式。
- 需要把项目级视觉规范沉淀到基础组件内部，而不是让页面层反复拼接或覆盖。

不推荐直接修改 `ui/` 的场景：

- 只是某个页面的临时视觉差异。
- 只是某个页面的业务文案、业务状态或局部交互。
- 可以通过 token、已有变体或组件组合解决，却改动了底层实现。

全局覆写的边界：

- `index.css` 只接收设计系统全局规则、`data-slot` 级契约、浏览器基础重置，以及第三方组件的全局皮肤覆写。
- `index.css` 中的全局覆写必须满足“不依赖具体页面语义，也不依赖应用壳层布局结构”这两个条件。
- 像 `sonner` 这类运行时注入到全局容器的第三方组件，可以在 `index.css` 中定义统一皮肤；但页面命名空间样式和壳层布局样式不能混入这里。

维护约束：

- 修改 `ui/` 时，默认假设会影响整个渲染层，必须检查所有现有消费方是否仍满足统一视觉约束。
- 如果未来需要跟进上游 shadcn 更新，必须通过 `npx shadcn@latest add --dry-run` 与 `--diff` 比对，再决定如何合并本地改动。
- 不要为了“保持原始组件不变”而把系统级修改硬塞进外挂 CSS；这会退回到脆弱覆写模式，不符合当前项目对设计系统可维护性的要求。

### 基础组件职责
#### `ui`、`widgets` 与页面组件的边界
分层目标：

- `ui` 负责“长什么样、怎么交互才统一”
- `widgets` 负责“跨页面怎么把基础组件组合成稳定部件”
- `pages/*/components` 负责“某个页面独有的业务语义和局部拼装”

判断问题时，按下面三个问题依次判断：

1. 如果去掉当前页面语境，这个组件是否仍然成立？
2. 如果只保留视觉骨架与交互基线，它是否还能作为通用原子被复用？
3. 如果未来第二个页面要用它，复制一份会不会明显浪费？

落位规则：

- 回答更偏“统一视觉 / 统一交互 / 通用语义骨架”，放 `ui`。
- 回答更偏“跨页面复用的稳定业务部件”，放 `widgets`。
- 回答更偏“只服务当前页面的数据结构、文案和事件”，放 `pages/*/components`。

当前项目中的典型例子：

- [`ActionBar`](./src/renderer/ui/action-bar.tsx) 属于 `ui`，因为它沉淀的是动作条的统一外观和结构语义。
- [`PageScaffold`](./src/renderer/widgets/page-scaffold/page-scaffold.tsx) 属于 `widgets`，因为它是跨页面共享的业务骨架，不只是单个原子组件。
- [`WorkbenchFileTable`](./src/renderer/pages/workbench-page/components/workbench-file-table.tsx) 属于页面组件，因为它直接绑定工作台页面的数据结构、交互动作和样式命名空间。

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

### 页面层禁区
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

### 目录升级与下沉规则
- 新组件默认先放最靠近使用点的位置，只有在复用边界已经清晰后再上提。
- 页面组件出现第二个页面消费者时，先评估是否提到 `widgets/`，不要继续跨页面引用页面目录。
- `widgets/` 如果只剩单一页面消费者，且强依赖该页面状态，可以下沉回页面目录，避免形成伪共享层。
- `ui` 只接受设计系统层收益明确的抽象；如果组件名称里已经带明显页面语义，一般不应进入这一层。
- 对 `ui` 的修改默认要假设会影响整个渲染层，因此改动前先检查现有消费方是否仍满足统一视觉约束。

### 审查命令
运行下面的命令检查是否有页面层视觉越权：

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
4. 调整导航或页面注册时，优先改 `src/renderer/app/navigation/`，避免把页面注册逻辑散落到壳层组件内。
5. 新增页面时，以 `pages/<page-name>/page.tsx` 为入口，再按需要并置 `<page-name>.css`、`mock.ts`、`types.ts` 或页面私有 hook / 辅助模块，并从导航注册表接入。
