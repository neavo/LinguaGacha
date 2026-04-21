# 渲染层规格

## 一句话总览
`src/renderer/` 是 LinguaGacha Electron 子工程的界面实现层，采用 `app / pages / widgets / shadcn / hooks / i18n / lib` 分层：`app` 管应用级壳层与全局状态，`pages` 管页面装配，`widgets` 管高于基础组件的复用组合层，`shadcn` 管 shadcn CLI 管理的基础组件源码，`hooks` 放跨页面复用的渲染层 Hook，`i18n` 与 `lib` 提供跨层支撑。

## 目录地图
| 路径 | 职责 |
| --- | --- |
| `app/` | 应用根、壳层组件、导航、全局 provider、桌面 API 适配、跨页面状态与应用级服务 |
| `pages/` | 页面入口、页面私有组件、页面 CSS、页面局部 hooks 与辅助模块 |
| `widgets/` | 跨页面复用的组合组件层，承接业务部件与少量不适合放进 shadcn 的共享反馈 / 组合组件 |
| `shadcn/` | shadcn CLI 管理的基础组件源码与其项目内定制，不承载页面业务语义 |
| `hooks/` | 跨页面复用的渲染层 Hook；当前用于统一保存快捷键等交互行为，不承载页面结构与全局状态容器 |
| `i18n/` | 本地化资源、渲染层翻译工具与文本渲染辅助 |
| `lib/` | 与页面语义无关的渲染层工具函数、类型辅助与通用纯逻辑 |
| `index.css` | 渲染层全局 token、shadcn / 第三方运行时全局皮肤、浏览器基础重置 |
| `index.tsx` / `index.html` | renderer 入口 |

## 分层模型
| 位置 | 应该放什么 | 不该放什么 |
| --- | --- | --- |
| `app/` | 应用根组件、壳层、导航、全局通知、桌面运行时上下文、跨页面状态与应用级服务 | 页面私有视觉细节、一次性局部组件、只服务单页的临时状态 |
| `pages/<page-name>/` | 页面装配入口、页面私有组件、页面 CSS、页面局部 hooks 与辅助模块 | 跨页面共享组件、全局服务、基础组件源码 |
| `widgets/` | 跨页面复用的组合组件层，例如 `CommandBar`、`AppTable`、`SearchBar`、`SegmentedToggle`、`SettingCardRow`、`ProgressToastRing` | shadcn 基础组件源码、只服务单页的临时拆分、应用级伪单例服务 |
| `shadcn/` | shadcn CLI 已安装组件的源码与项目内定制，例如 `button`、`card`、`dialog`、`sidebar`、`table`、`tooltip` | 页面业务语义、页面文案、应用级服务、自定义非 shadcn 共享组件 |
| `hooks/` | 跨页面复用的交互 Hook，例如保存快捷键、统一键盘监听、无页面语义的副作用封装 | 页面布局、页面私有状态、需要依赖单个页面目录的逻辑 |
| `i18n/` | 文案资源、翻译 hook、富文本渲染辅助 | 页面结构、业务状态、基础组件实现 |
| `lib/` | 工具函数、纯逻辑、类型辅助、无页面语义的共享工具 | UI 结构、业务组件、状态容器 |

## 依赖方向与落位规则
- `shadcn/` 只能依赖 `lib/`、其他 `shadcn/` 组件与 `index.css` 中定义的全局 token / 皮肤契约。
- `hooks/` 可以依赖 `lib/`、`i18n/`、浏览器运行时与 React Hook，不承载页面布局，不反向依赖具体页面目录。
- `widgets/` 可以依赖 `shadcn/`、`lib/`、`i18n/`，但不反向依赖具体页面目录。
- `pages/` 可以依赖 `widgets/`、`shadcn/`、`app/` 中显式暴露的上下文 / 服务接口，但不要让页面内部实现反向被其他层引用。
- `app/` 可以依赖 `widgets/`、`shadcn/`、`lib/` 与 `i18n/`；只被应用壳层消费的组件直接留在 `app/`，不要伪装成跨页面共享。
- 如果一个变化离开当前页面后仍成立，并且已经或即将被多个消费点复用，优先放 `widgets/`。
- 如果一个组件只在应用壳层消费，或者强依赖应用级上下文 / 生命周期，就留在 `app/`。
- 如果一个组件不是 shadcn CLI 管理的基础组件，就不要放进 `shadcn/`。

## `shadcn/` 目录边界
### 组件归属
- `src/renderer/shadcn/` 只存放 shadcn CLI 已安装组件的源码文件，以及这些组件在本项目内的结构、变体、无障碍和 token 级定制。
- 当前归属判断以 `components.json` 和 `npx shadcn@latest info --json` 返回的已安装组件集为权威来源。
- 自定义共享组件、业务反馈组件、页面语义组件，以及 shadcn CLI 不识别的额外组合组件不得进入 `shadcn/`。

### 修改路径
1. 系统级视觉语义优先改 `index.css` 中的 token 和全局皮肤。
2. 若现有 `variant`、`size`、`data-slot`、组合方式已能表达需求，优先复用，不额外扩暴露面。
3. 只有在需要统一修改基础组件骨架、结构语义、交互基线或无障碍行为时，才直接修改 `shadcn/` 源码。
4. 跟进上游 shadcn 更新时，先执行 `npx shadcn@latest add --dry-run` 与 `--diff`，再合并本地定制。

### 明确禁止
- 不要把页面文案、页面状态、业务规则或页面局部布局直接做进 `shadcn/`。
- 不要把只被一个页面或一个应用级服务消费的自定义组件塞进 `shadcn/`，哪怕它“长得像基础组件”。
- 不要在 `shadcn/` 内再维护局部 `SPEC.md`；目录规则统一由本文件定义。

## `widgets/` 目录边界
### 组件归属
- `widgets/` 是高于 `shadcn/` 的复用组合层，承接跨页面复用的业务部件与少量共享反馈 / 组合组件。
- 典型示例包括：
  - `CommandBar`：跨页面动作条壳层与按钮编排
  - `AppTable`：跨页面表格交互骨架
  - `SearchBar`：规则页搜索与筛选条
  - `SegmentedToggle`：跨页面复用的分段单选开关
  - `SettingCardRow`：设置页复用的说明 + 操作行
  - `ProgressToastRing`：被应用级 toast 消费的共享反馈组件

### 结构与样式
- widget 目录名与源码文件统一使用 `kebab-case`。
- widget 一旦需要私有样式或辅助模块，优先采用“目录 + 同名入口文件”的结构。
- widget 私有 CSS 必须由 widget 自己导入，使用 widget 命名空间，不要把基础样式入口继续压回页面或全局。
- 页面如果需要额外补样式，只能补局部布局和本页面语义，不重新接管 widget 的基础壳层。

### 演化规则
- 当页面组件出现第二个稳定消费者时，先判断是否上提到 `widgets/`。
- 当 `widgets/` 组件只剩单一消费者，且强依赖该页面或应用壳层状态时，应下沉回对应目录，避免形成伪共享层。
- `widgets/` 不重新定义基础视觉基线；若需要改 `Card`、`Button`、`Table` 等基础契约，应先回到 `shadcn/` 或 `index.css` token 处理。

## `app/` 与 `pages/` 的稳定职责
### `app/`
- 应用根组件固定在 `app/index.tsx`，负责组装 provider、主题源、导航协调逻辑和应用壳层。
- `app/navigation/` 是导航权威来源：`types.ts` 定义 route id，`schema.ts` 组织显示分组，`screen-registry.ts` 定义 route 到页面组件的映射。
- `app/shell/` 只承载应用壳层组件与壳层布局样式；例如 `AppSidebar`、`AppTitlebar` 这类只被壳层消费的组件必须留在这里。
- 应用级通知、桌面运行时上下文、跨页面状态和与 Electron 桥接强耦合的适配逻辑统一收口在 `app/`。
- `app/state/v2/` 统一承载 `ProjectStore`、bootstrap stream 消费、patch 合并和项目运行态辅助逻辑；新增 V2 协议逻辑优先下沉到这里，而不是继续堆在页面 hook 里。
- `app/state/desktop-runtime-context.tsx` 当前只保留薄装配职责：持有 `ProjectStore` 实例、对接 `/api/v2/project/bootstrap/stream` 与 `/api/v2/events/stream`，并把 `project.patch` 转成页面可消费的变更信号。
- 应用语言的唯一写入口固定在 `app/state/desktop-runtime-context.tsx`；`i18n/` 只允许根据 `settings_snapshot.app_language` 派生渲染语言，不得再维护独立可写 locale 状态。

### `pages/`
- 页面目录固定以 `page.tsx` 为入口；同目录可并置 `<page-name>.css`、`components/`、`types.ts`、`use-*.ts`、`mock.ts` 和页面私有辅助模块。
- 页面入口负责装配状态、调用页面私有 hook、组合 widget / shadcn 组件树，并导入页面 CSS。
- 页面私有组件允许依赖该页面的文案键、状态、类型和样式命名空间，但不应被其他页面直接引用。
- 工作台、校对页和规则页的主读路径默认来自 `ProjectStore + selector / worker`；不要在新逻辑里重新引入 `/api/workbench/snapshot`、`/api/proofreading/snapshot` 这类页面级首包模型。

## 样式与资源边界
- `index.css` 只负责：
  - 全局 token，如 `--ui-*`
  - shadcn / 第三方运行时的全局皮肤
  - 浏览器基础重置与全局 class 契约
- `app/shell/app-shell.css` 只保留壳层骨架、工作区和页面容器布局。
- `app/shell/app-sidebar.css` 与 `app/shell/app-titlebar.css` 各自收口壳层私有视觉，不把这类样式放进全局或 widgets。
- 页面私有样式必须放在页面目录，由页面入口统一导入；页面子组件不要各自导入页面级 CSS。
- widget 私有样式由 widget 自己导入；带 widget 语义的类名不要放进页面 CSS 或 `index.css`。
- 第三方运行时 DOM、Portal 容器和 Sonner / Radix 的全局皮肤只允许在 `index.css` 处理。
- `public/` 只放原始静态资源；本地化文案、mock 数据和页面配置属于源码资源，必须留在 `src/renderer/`。

## 视觉尺寸单位
- `src/renderer/app/`、`src/renderer/pages/`、`src/renderer/widgets/`、[`index.css`](./index.css) 与 `src/renderer/app/shell/*.css` 默认执行 `px-first`。
- 上述范围内，字面量长度、字号、圆角、边框、阴影偏移、间距、容器宽高，以及 Tailwind arbitrary value / 内联样式字符串里的尺寸值，默认统一写 `px`。
- Tailwind 预设 spacing / sizing utility 视为框架 token，不按显式尺寸字面量处理；一旦写 arbitrary value，例如 `text-[...]`、`max-w-[...]`、`grid-cols-[...]`，就回到 `px-first`。
- `letter-spacing` 允许且仅允许使用 `em`，因为它必须跟随当前字号缩放；除此之外不要继续写 `em`。
- `line-height` 统一使用无单位数值，例如 `1.4`、`1.45`、`1.5`。
- 响应式字号允许使用 `clamp()`，但只允许 `px + vw + px` 组合，禁止在 `clamp()` 中混入 `rem`。
- `%`、`vw`、`vh`、`svh`、`dvh`、`lvh` 仅用于容器占满、视口适配和比例关系，不替代常规视觉尺寸。
- `shadcn/` 源码当前不纳入字面量 `px` 约束；若后续要收紧这层，必须单独立项评估影响范围。

## 全局 token、主题与真实粗体
- 所有 `--ui-*` token 只能在 [`index.css`](./index.css) 定义。
- 渲染层默认使用真实字体字重表达强调；`shadcn` 组件跟随 upstream 当前基线，非 `shadcn` 组件默认优先使用 `font-medium`。
- `data-ui-text`、`.ui-text-emphasis`、`--ui-font-stroke-emphasis` 与 `-webkit-text-stroke` 不在当前规范内，禁止引入。
- `index.css` 负责注册中英文普通/粗体字体资源，并把 `400` 映射到 Regular、把 `500/600/700` 映射到 Bold。
- 组件主题只能跟随应用根主题源；基础组件和组合组件都不得自建第二套并行主题状态。

## 渲染层审查命令
运行下面的命令执行渲染层硬规则审查：

```bash
npm run renderer:audit
```

`renderer:audit` 当前负责：
- 检查 `--ui-*` 是否只在 `index.css` 中定义
- 检查 `px-first` 作用域中的 `rem` 字面量
- 检查已接入页面命名空间是否越权改写 `PageShell` / `Card` / `Button` / `Table` 的基础视觉

`renderer:audit` 当前不负责：
- 决定一个改动究竟该落在 `app/`、`pages/`、`widgets/` 还是 `shadcn/`
- 自动覆盖所有页面命名空间；新页面接入后要同步扩门闩
- 替代跨页面回归、主题联调和运行时交互验证

不要把“脚本没报错”误解成“分层和设计判断已经完成”。

## 验证与维护
- 修改 `shadcn/`、`widgets/`、`app/`、`index.css` 或 `app/shell` 样式时，至少回归所有现有消费者，不能只验证当前页面。
- 涉及渲染层结构、样式边界或基础组件契约的改动，至少运行：
  - `npm run renderer:audit`
  - `npm run lint`
  - `npx tsc -p tsconfig.json --noEmit`
  - `npx tsc -p tsconfig.node.json --noEmit`
- 对亮暗主题都有明显视觉影响的改动，至少做一轮手工主题回归，确认字号、间距、分隔线和强调样式没有漂移。
