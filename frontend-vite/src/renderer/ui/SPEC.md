# 渲染层 ui 设计系统规范

## 一句话总览
`src/renderer/ui/` 承担 `frontend-vite` 渲染层的设计系统原子与薄封装组件：它只负责统一外观、交互基线、无障碍骨架和第三方基础组件适配，不承载页面业务语义。

## 职责边界
| 应该放什么 | 不该放什么 |
| --- | --- |
| `Button`、`Card`、`Table`、`Empty`、`Dialog`、`Select`、`Tooltip` 这类设计系统原子与薄封装组件 | 页面业务文案、具体页面状态、接口请求、项目/工作台等业务语义 |
| 第三方基础组件适配层，例如 shadcn 组件的项目内皮肤与结构收口 | 只会被单一页面消费的临时组件 |
| `data-slot` 契约、变体、无障碍骨架、统一交互态 | 带明显页面语义或跨页面业务语义的部件 |

- `ui/` 可以依赖 `lib/` 与其他 `ui/` 组件，但不要反向依赖 `widgets/` 或 `pages/`。
- 如果一个组件已经带明显页面语义，或需要页面文案、页面状态、页面事件流才能成立，通常就不该进入 `ui/`。
- 页面级动作条组件位于 [`../widgets/command-bar/command-bar.tsx`](../widgets/command-bar/command-bar.tsx)；`ui/` 不承担这类业务部件。

## 文档与门闩
| 内容 | 权威来源 | 说明 |
| --- | --- | --- |
| 子工程总览、Electron 边界、渲染层入口 | [`../../../SPEC.md`](../../../SPEC.md) | 回答“这个子工程怎么组织” |
| 设计系统、基础组件职责、全局样式边界 | `src/renderer/ui/SPEC.md` | 回答“`ui/` 这一层该怎么改” |
| 可稳定自动判定的硬规则 | `npm run ui:audit` / `scripts/check-ui-design-system.mjs` | 负责直接拦截明显越权写法 |

约定：下文标记 `（门闩）` 的规则已经接入 `npm run ui:audit`。

## 全局 token、主题与中文强调
所有 UI 语义 token 统一定义在 [`../index.css`](../index.css)，当前统一使用的语义前缀如下：

- `--ui-radius-*`
- `--ui-surface-*`
- `--ui-edge-*`
- `--ui-shadow-*`
- `--ui-space-*`
- `--ui-toolbar-*`
- `--ui-table-*`
- `--ui-font-stroke-*`

约束：

- 新视觉语义必须先进入全局 token，再由基础组件消费。
- 组件主题只能跟随应用根主题源；单个基础组件或适配层不得自行监听 DOM、直接读写 `localStorage`，或维护第二份并行主题状态。
- `.ui-text-emphasis` 与 `[data-ui-text='emphasis']` 是唯一允许的中文强调语义入口。
- `--ui-*` 只能在 [`../index.css`](../index.css) 定义。`（门闩）`
- `-webkit-text-stroke` 只能出现在 [`../index.css`](../index.css)。`（门闩）`
- 中文主字体不依赖原生粗体；渲染层禁止重新引入 `font-weight: 500/600/700+` 与 Tailwind 粗体类。`（门闩）`
- `@font-face` 只能声明字体文件真实支持的 `font-weight`，不要把单一字库伪装成多字重范围。

## 单位规范与全局覆写边界
- `src/renderer/app/`、`src/renderer/pages/`、`src/renderer/widgets/`、[`../index.css`](../index.css) 与 [`../app/shell/app-shell.css`](../app/shell/app-shell.css) 默认执行 `px-first`。
- 上述范围中的长度、字号、圆角、边框、阴影偏移、间距、容器宽高统一使用 `px`；已有公共尺寸优先沉到全局 token 或基础组件变体，不要在页面层重复发明一套私有尺寸。
- `letter-spacing` 允许且仅允许使用 `em`，因为它需要跟随当前字体大小一起缩放；除此之外不要在这些目录里继续写 `em`。
- `line-height` 统一使用无单位数值，例如 `1.4`、`1.45`、`1.5`，不要改成 `px` 或 `rem`。
- 响应式字号允许使用 `clamp()`，但只允许 `px + vw + px` 组合，禁止在 `clamp()` 中混入 `rem`。
- `src/renderer/ui/` 里的 shadcn 基础组件当前不纳入字面量 `px` 约束；如果后续要继续推进单位收敛，必须单独立项并先评估组件层影响范围。
- [`../index.css`](../index.css) 只接收设计系统全局规则、`data-slot` 级契约、浏览器基础重置，以及第三方组件的全局皮肤覆写。
- `index.css` 中的全局覆写必须同时满足“不依赖具体页面语义”和“不依赖应用壳层布局结构”。
- 页面 CSS 不得直接覆写第三方运行时 DOM、Portal 容器或全局 class。
- 如果一个动画能由 CSS 完整表达，就不要把关键节奏拆成“一半 CSS、一半 TS 内联样式”，避免两套参数源长期漂移。

## 第三方基础组件定制路径
`ui/` 里的 shadcn 组件和其他第三方基础组件适配层都视为项目自有源码，但所有定制都必须先判断“这次变化到底属于哪一层”，再决定落点。

### 判定路径
1. 这次变化是系统级视觉语义，还是单页业务差异？
2. 它影响的是 token、组件骨架/交互、应用级状态机，还是页面布局与文案？
3. 它是在修复一个调用点，还是在建立整个渲染层的统一规则？
4. 如果第二个页面复用这套行为，当前改法是否仍然成立？

只要这四个问题里有任意一个答不清，就不要直接修改 `ui/` 源码或页面 CSS，先把变化归类清楚。

### 定制优先级
1. 优先改 token、CSS 变量和全局皮肤，把系统级视觉变化收敛到 [`../index.css`](../index.css)。
2. 如果现有 `variant`、`size`、`data-slot`、组件组合已经能表达需求，优先复用，不额外改底层实现。
3. 只有在需要统一修改组件骨架、结构语义、交互基线、无障碍行为或全站共享变体时，才直接修改 `src/renderer/ui/`。
4. 只有在变化属于应用级生命周期、异步状态汇聚、伪单例、退场时机、输入归一化等跨页面规则时，才落到 `src/renderer/app/`。
5. 只有在前三层都无法表达，且目标是第三方运行时 DOM、Portal 内容或容器皮肤时，才使用全局覆写。

### 明确禁止
- 不要把单页文案、局部布局、临时交互直接做进 `ui/` 或全局样式。
- 不要为了局部修复而扩大第三方组件暴露面；宁可增加一层应用级适配，也不要让业务页面越来越理解底层实现细节。
- 不要把复杂生命周期规则散落在页面层，例如延迟退场、状态接管、异步任务反馈、单实例协调等，都必须只有一个权威实现。

## 基础组件职责
### Card
[`card.tsx`](./card.tsx) 负责：

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

### Button
[`button.tsx`](./button.tsx) 负责：

- 按钮圆角
- 高度
- 内边距
- 基础交互态

当前约定：

- 卡片圆角：`4px`
- 按钮圆角：`8px`
- 工具条按钮使用 `size="toolbar"`

### Table
[`table.tsx`](./table.tsx) 负责：

- 表头高度
- 行高
- 分隔线强度
- hover / selected 背景

页面层只保留：

- 列宽
- 对齐方式
- sticky / scroll 等布局能力

## 页面层边界
业务页面和部件层允许：

- 栅格布局
- 间距组合
- 响应式规则
- 语义色，例如 success / warning 文本

业务页面和部件层不承担基础视觉基线，页面私有 CSS 只能调布局、密度与局部语义色。对已接入门闩的页面命名空间，下面这些越权会被 `ui:audit` 直接拦截：

| 基础组件 | 页面层不得重写 |
| --- | --- |
| `Card` | `background`、`box-shadow`、`border-radius`、`border-color` |
| `Button` | `border-radius`、`box-shadow`、`background` |
| `Table` | `border-bottom`、`background`、`height`、`font-size`、`color` |

额外约束：

- 页面和部件层不要自己定义卡片表面、卡片阴影、按钮圆角与基础表格分隔线强度。
- 需要中文强调时，只能消费 `.ui-text-emphasis` 或 `[data-ui-text='emphasis']`，不要在页面层另起一套强调样式。

## 验证与维护
- 修改 `ui/`、`app/` 中的全局服务，或 [`../index.css`](../index.css) 里的第三方皮肤时，必须至少回归所有现有消费方，不能只验证当前页面。
- 对运行时全局组件，必须保留一个可交互的调试入口或 playground；后续调整布局、动画、主题或生命周期时，应先在该入口验证，再进入业务页面联调。
- 如果未来需要跟进上游 shadcn 更新，必须通过 `npx shadcn@latest add --dry-run` 与 `--diff` 比对，再决定如何合并本地改动。
- 不要把系统级修改硬塞进外挂 CSS；这会退回到脆弱覆写模式，不符合当前项目对设计系统可维护性的要求。

运行下面的命令执行当前已接入的设计系统门闩：

```bash
npm run ui:audit
```

当前 `ui:audit` 会检查：

- `--ui-*` 是否只在 [`../index.css`](../index.css) 中定义
- 中文强调相关写法是否回到 [`../index.css`](../index.css) 与统一强调入口
- `font-weight: 500/600/700+` 与 Tailwind 粗体类是否重新出现在渲染层源码中
- 已接入页面命名空间是否越权改写 `Card` / `Button` / `Table` 的基础视觉

当前 `ui:audit` 不负责：

- 判断一个改动究竟该落在 `app/`、`ui/`、`widgets/` 还是页面目录
- 判断第三方基础组件定制应该走 token、组件变体、应用级适配还是全局覆写
- 自动覆盖所有页面命名空间；新页面接入后要同步扩门闩
- 替代跨页面回归、主题联调与运行时交互验证

不要把“脚本没报错”误解成“设计层判断已经完成”。
