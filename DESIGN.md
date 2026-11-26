---
name: LinguaGacha
description: 原生桌面质感的 AI 文本翻译工具，萌、极客、内敛。
colors:
  background: "#f3f4f6"
  foreground: "#25272c"
  card: "#fbfcfd"
  popover: "#fbfcfd"
  primary: "#ad5a17"
  primary-foreground: "#fff7ed"
  secondary: "#e8eaee"
  secondary-foreground: "#4d535d"
  muted: "#e5e7eb"
  muted-foreground: "#717783"
  accent: "#eef0f3"
  accent-foreground: "#4b515b"
  border: "#d6dae0"
  ring: "#d97924"
  success: "#22c55e"
  warning: "#f97316"
  failure: "oklch(0.61 0.18 28)"
  chart-amber: "#f2b84b"
  chart-coral: "#d85f42"
  chart-slate: "#7a8491"
  sidebar: "#f3f4f6"
  sidebar-accent: "#e1e5eb"
  sidebar-border: "#d2d7df"
  dark-background: "#111318"
  dark-foreground: "#eef1f5"
  dark-card: "#171a20"
  dark-popover: "#171a20"
  dark-primary: "#f49a51"
  dark-primary-foreground: "#2b1b0f"
  dark-secondary: "#20242b"
  dark-secondary-foreground: "#e8ebf0"
  dark-muted: "#1d2128"
  dark-muted-foreground: "#aab1bc"
  dark-accent: "#252a32"
  dark-accent-foreground: "#edf0f5"
  dark-border: "#343a44"
  dark-ring: "#f4a261"
  dark-success: "#4ade80"
  dark-warning: "#fb923c"
  dark-failure: "oklch(0.68 0.17 28)"
  dark-chart-gold: "#ffb454"
  dark-chart-coral: "#ee6f4d"
  dark-chart-amber: "#d98b36"
  dark-chart-slate: "#8ea0b5"
  dark-sidebar: "#111318"
  dark-sidebar-accent: "#20242b"
  dark-sidebar-border: "#303640"
typography:
  display:
    fontFamily: "Twemoji, LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Twemoji, LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Twemoji, LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.018em"
  body:
    fontFamily: "Twemoji, LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Twemoji, LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  button: "4px"
  card: "4px"
  overlay: "6px"
  workspace-corner: "8px"
  pill: "999px"
spacing:
  boundary: "1px"
  selection-rail: "3px"
  list-gap: "8px"
  dense-gap: "12px"
  page-padding: "16px"
  section-gap: "16px"
  control-height: "32px"
  sidebar-row-height: "36px"
  toolbar-button-height: "36px"
  table-row-height: "36px"
  titlebar-height: "40px"
  table-head-height: "42px"
  toolbar-height: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "color-mix(in srgb, {colors.failure} 10%, transparent)"
    textColor: "{colors.failure}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  badge-neutral:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "0 8px"
  badge-brand:
    backgroundColor: "color-mix(in srgb, {colors.primary} 14%, {colors.popover})"
    textColor: "color-mix(in srgb, {colors.primary} 85%, {colors.foreground})"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "0 8px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.page-padding}"
  input-default:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "4px 10px"
  tabs-list:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "4px"
  tabs-trigger-active:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    height: "24px"
    padding: "0 12px"
  command-bar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    height: "{spacing.toolbar-height}"
    padding: "0 12px"
---

# Design System: LinguaGacha

## Overview

**Creative North Star: "安静的本地炼金台"**

LinguaGacha 是一台面向长时间文本翻译与校对的本地桌面工作台。固定标题栏与侧栏围住连续的工作面，高密度表格、CodeMirror 编辑器、结构化日志与 Agent 对话时间线承接高频重复操作。产品表达基调是「萌、极客、内敛」：萌感落在克制的细节、柔和状态反馈与暖橙线索；极客感落在等宽倾向字族、清晰数据密度与可追踪的工作流；内敛落在冷灰工作底面与稀缺的强调色。

样式资产遵循单一事实源与分层消费：

- 全局 token 与明暗主题唯一定义于 [`src/frontend/index.css`](src/frontend/index.css)。
- 基础控件原语由 [`src/frontend/shadcn/`](src/frontend/shadcn/) 承接。
- 产品入口与可复用生产组件由 [`src/frontend/widgets/`](src/frontend/widgets/) 承接（例如业务按钮统一经 `AppButton` 入口）。
- [`src/frontend/app/shell/`](src/frontend/app/shell/)、`src/frontend/features/` 与 `src/frontend/pages/` 只消费全局 token，在各自所有权内组合布局与状态。

**Key Characteristics:**

- **原生桌面质感**：固定标题栏、可调宽侧栏、稳定工作区边界与即时反馈，不制造网页式长页动线。
- **冷灰浅色默认，暗色同构**：冷蓝灰底面服务长时间阅读，暗色主题按相同层级映射到深石墨面。
- **暖橙低频强调**：主色只在主操作、选中轨、键盘焦点、进度与关键线索处出现。
- **生产密度优先**：默认紧凑尺寸与高信息密度，滚动收敛在工作区或生产组件内部。
- **过程透明可选取**：Agent 思考、工具调用、校对上下文与日志保持可选取、可展开、可回溯。
- **动态字号与静态门禁**：字号跟随用户三档偏好缩放，样式边界由 `npm run check` 静态校验。

## Colors

调色板由低饱和冷蓝灰工作面与低频暖橙强调色组成；暗色主题保持相同语义对比关系，不滑向纯黑底或高饱和霓虹科技风。

### Primary

| 语义角色 | 浅色 / 暗色 | 用途 |
|---|---|---|
| **暖橙主强调** (`primary`) | `#ad5a17` / `#f49a51` | 主按钮、当前导航轨、选中行轨、进度与关键可操作状态 |
| **聚焦暖橙** (`ring`) | `#d97924` / `#f4a261` | 键盘 `focus-visible` 描边、编辑器聚焦边界与短时拖拽强调 |
| **暖米前景** (`primary-foreground`) | `#fff7ed` / `#2b1b0f` | 主强调底面上的文字与图标，确保明暗主题清晰可读 |

### Secondary

| 语义角色 | 浅色 / 暗色 | 用途 |
|---|---|---|
| **冷灰次级面** (`secondary`) | `#e8eaee` / `#20242b` | 次级按钮、中性信息胶囊、弱状态背景与分区底面 |
| **石墨次级文字** (`secondary-foreground`) | `#4d535d` / `#e8ebf0` | 次级控件文字与辅助标签，弱于正文但保持足够对比 |

### Tertiary

| 语义角色 | 浅色 / 暗色 | 用途 |
|---|---|---|
| **蜜黄 / 金橙图表色** (`chart-amber` / `dark-chart-gold`) | `#f2b84b` / `#ffb454` | 统计图表与进度分段辅助系列 |
| **珊瑚图表色** (`chart-coral` / `dark-chart-coral`) | `#d85f42` / `#ee6f4d` | 图表分类系列，不得替代失败状态红 |
| **暗色琥珀辅助** (`dark-chart-amber`) | — / `#d98b36` | 暗色主题下承接 `--chart-4` 区分度 |
| **钢灰图表色** (`chart-slate` / `dark-chart-slate`) | `#7a8491` / `#8ea0b5` | 低优先级数据系列与辅助参照 |

### Status

| 语义角色 | 浅色 / 暗色 | 用途 |
|---|---|---|
| **状态绿** (`success`) | `#22c55e` / `#4ade80` | 仅表达成功、完成、已打开或校验通过 |
| **警告橙** (`warning`) | `#f97316` / `#fb923c` | 仅表达需注意、停止中或临近超时的非阻断状态 |
| **失败红** (`failure`) | `oklch(0.61 0.18 28)` / `oklch(0.68 0.17 28)` | 仅表达失败、无效输入与破坏性操作 |

### Neutral

| 语义角色 | 浅色 / 暗色 | 用途 |
|---|---|---|
| **冷灰工作台** (`background` / `sidebar`) | `#f3f4f6` / `#111318` | 窗口、标题栏、侧栏与工作区共用底面 |
| **石墨正文** (`foreground`) | `#25272c` / `#eef1f5` | 正文、标题与图标默认色，避免纯黑纯白硬对比 |
| **近白承载面** (`card` / `popover`) | `#fbfcfd` / `#171a20` | 独立卡片、弹层、表头、输入框与编辑器底面 |
| **雾灰静音面** (`muted`) | `#e5e7eb` / `#1d2128` | 分段容器、只读底面、用户消息气泡与内嵌分组混色基底 |
| **静音文字** (`muted-foreground`) | `#717783` / `#aab1bc` | 占位符、说明文字、次级表头与辅助元信息 |
| **浅冷灰强调面** (`accent` / `sidebar-accent`) | `#eef0f3` (`#e1e5eb`) / `#252a32` (`#20242b`) | 悬停态、选中行与低强度交互反馈 |
| **柔冷灰边框** (`border` / `sidebar-border`) | `#d6dae0` (`#d2d7df`) / `#343a44` (`#303640`) | `1px` 分割线、输入描边、卡片与表格边界 |

### Named Rules

**The Cool Desktop Rule.** 中性面与中性文字必须保持轻微冷蓝灰调，禁止使用纯黑 (`#000000`)、纯白 (`#ffffff`) 或高饱和默认蓝作为工作面基色。

**The Accent Scarcity Rule.** 暖橙只在主操作、选中态、焦点、进度与关键状态线索处出现；禁止在单屏内大面积铺陈主色。

**The Status Honesty Rule.** 状态绿、警告橙与失败红只服务状态语义，禁止用于常规装饰或无状态标签。

**The Scoped Exception Rule.** 模型供应商品牌色、CodeMirror 语法高亮与主输入器悬停时的 `1px` 鼠标追随霓虹描边仅限各自局部边界生效，不得晋升为全局强调色或扩散到普通控件。

## Typography

- **Emoji Font:** `Twemoji`（置于字体栈首位，净化 cmap 仅覆盖 Unicode Emoji 与 Emoji Component，避免劫持普通拉丁字符与数字）
- **Primary / Mono Font:** `LGMono`（Monaspace Neon `400–700` 可变字重、`size-adjust: 90%`、斜体轴 `slnt -11`）
- **CJK Fallback:** `LGBaseFont`（Regular `400` / Bold `500–700`）→ `Segoe UI`、`Microsoft YaHei UI`、`PingFang SC`、`system-ui`、`sans-serif`

**Character:** 全局正文、标题、代码与数据表格共用同一套等宽倾向字族，让路径、术语、模型名、日志与译文在同一视线基准下切换而无割裂感。用户关闭 `LGBaseFont` 偏好（`data-lg-base-font="disabled"`）时，仅移除该中文字体并保留 `Twemoji`、`LGMono` 与系统回退。

**Dynamic Font Scale:** 根基线 `--ui-font-size-base` 按用户字号偏好取三档：`normal` (`14px`)、`larger` (`15px`)、`largest` (`16px`)。所有 `--ui-font-size-10` 至 `--ui-font-size-42` 以该基线做整数像素偏移，生产样式必须消费字号变量而非硬编码像素字号。

### Hierarchy

| 角色 | 标准档位与变量 | 字重 | 行高 | 字距 | 典型用途 |
|---|---|---|---|---|---|
| **Display** | `42px` (`--ui-font-size-42`) | `400` | `1` | `-0.025em` | 工作台统计大数字与关键任务计数 |
| **Headline** | `16px` (`--ui-font-size-16`) | `500` | `1.35` | `-0.02em` | 弹窗/覆盖层主标题、拖放提示与 Markdown `h1` |
| **Title** | `14px` (`--ui-font-size-14`) | `500` | `1.25` | `-0.018em` | 卡片标题、设置行标题、侧栏主导航与 Markdown `h2` |
| **Body** | `13px` (`--ui-font-size-13`) | `400` | `1.5` | `0em` | 正文、表格单元格、输入框、按钮正文；长阅读与编辑器行高升至 `1.6–1.7` |
| **Label** | `12px` (`--ui-font-size-12`) | `500` | `1.4` | `0em` | 表头、信息胶囊、工具栏按钮、Tooltip、说明文字与状态元信息 |

### Named Rules

**The Tool Text Rule.** 排版层级只服务快速扫描与操作定位，禁止网页式超大宣传标题或另造展示字体。

**The Measured Data Rule.** 耗时、速度 (TPS)、行号、进度计数与上下文用量必须启用 `tabular-nums`，确保实时刷新时列宽与基线稳定。

**The Dynamic Scale Rule.** 生产源码与样式一律消费 `--ui-font-size-*` 语义变量（或用于布局的 `0` / 相对比例），禁止写死固定像素字号绕过用户字号偏好。

## Layout

主窗口以 `1280 × 800px` 为创建与最小尺寸基线，占满可用视口并锁定外层 `body` 滚动。标题栏、侧栏与工作区共用纯色底面形成连续桌面壳层：

- **标题栏**：默认高 `40px`（`--titlebar-height`），承担窗口拖动区域与左右安全区留白。
- **侧栏**：宽度可拖拽调整，分为固定顶部全局导航、中间独立滚动工程列表、固定底部工具入口三段。
- **工作区**：左上角保留 `8px` 壳层转角与 `1px` 上左边界，默认四周内边距 `16px`；贴边页面（`data-layout="edge-to-edge"`）由工作区裁切圆角并自行管理内部边距与滚动。
- **工程工作区自适应断点**：当工程工作区宽度 `≥ 1280px` 时，右侧「工作台 / 翻译质量」双面板自动停靠为 `240px` 宽常驻卡片轨，内容区右侧让出避让轨；`< 1280px` 时收起为顶栏下拉浮层，避免挤压主工作面。

| 间距层级 | 尺寸与 token | 用途 |
|---|---|---|
| 页面与区块主节奏 | `16px` (`--ui-page-pad-*` / `--ui-page-gap` / `--ui-section-gap`) | 工作区外边距、页面主区块间距与默认卡片内边距 |
| 密集分组间距 | `12px` (`--ui-section-gap-dense`) | 紧凑表单、工具栏内边距与统计卡片网格间距 |
| 紧凑列表间距 | `8px` (`--ui-list-gap-dense`) | 侧栏组边距、列表项间距与行内元素分组 |
| 微间距 | `4px` / `2px` | 卡片标题与说明间距、操作组内按钮间隙 |

**内部阅读栏**：仅连续阅读与对话面从满幅工作区中收窄——Agent 输入器以 `1120px` 为工作宽度基准，时间线在其内侧各缩进 `24px`（最大 `1072px`），空态引导限制为 `520px`，决策框限制为 `720px`。宽态右侧停靠时，对话页与文档预览仅在存在富余宽度时对称补齐左侧留白以保持居中。表格、编辑器与日志详情继续占满可用宽度。

### Named Rules

**The Fixed Shell Rule.** 标题栏、侧栏与工作区边界必须稳定；工作区已提供外边界时，填满工作区的页面根节点不得叠套第二层外框卡片。

**The Dense Rhythm Rule.** 布局以 `16px` 为主节奏并按 `12px / 8px / 4px` 递减；出现大留白必须有明确的阅读或聚焦理由。

**The Internal Reading Lane Rule.** 窄阅读栏只存在于满幅生产工作面内部，禁止将整个应用页面改造成网页式居中容器。

## Elevation & Depth

常驻桌面工作面保持扁平，通过色面层级与 `1px` 细边界区分主次：工作区底面（`--background`）→ 独立卡片（`--card`）→ 卡片内嵌分组（`--ui-group-surface`，`muted` 58% 与 `popover` 混色）。

投射阴影仅用于浮层、弹窗、下拉菜单、右键菜单与拖拽反馈，统一复用随明暗主题切换的 `--ui-shadow-overlay`（浅色 `0 18px 48px -24px` 30% 前景色；暗色 `0 24px 52px -20px` 72% 黑色）。Toast 与编辑器内提示采用更轻的局部阴影。

### Portal Layer Stack

所有 Portal 浮层严格按语义层级排序，顺序固定为 `overlay < popover < tooltip < blocking`：

| 语义 token | 值 | 承载对象 |
|---|---|---|
| `--ui-layer-overlay` | `50` | Dialog、AlertDialog、Sheet 及其背景遮罩 |
| `--ui-layer-popover` | `60` | Select、Dropdown、Context Menu、Popover 面板 |
| `--ui-layer-tooltip` | `70` | 通用 Tooltip 与 CodeMirror 文本标记 Tooltip |
| `--ui-layer-blocking-overlay` | `9998` | 阻断式进度遮罩（`backdrop-filter: blur(4px)`） |
| `--ui-layer-blocking-feedback` | `9999` | 阻断式进度反馈 Toast |

### Named Rules

**The Flat-By-Default Rule.** 常驻界面依靠色面与 `1px` 边界分层，不在静止卡片上施加浮夸阴影。

**The Semantic Layer Stack Rule.** 跨 Portal 层叠只消费 `--ui-layer-*` 语义 token，页面不得硬编码高层级 `z-index`。

## Shapes

工作面采用克制的小圆角与利落的直线边界，回避移动端大圆角或网页标签感：

| 圆角层级 | 数值与 token | 适用对象 |
|---|---|---|
| **基础工作面** | `4px` (`--ui-radius-button` / `--ui-radius-card`) | 按钮、输入框、下拉触发器、卡片、编辑器、分段切换与工具栏项 |
| **独立浮层** | `6px` (`--radius-xl`) | 模态弹窗、批注与候选浮层、Tooltip 预览面板与用户消息气泡主角 |
| **工作区壳层** | `8px` | 工作区容器左上角转角 |
| **胶囊与圆形** | `999px` (`--ui-radius-pill`) | 信息胶囊、状态灯、圆形发送/跟随按钮、头像与滚动条滑块 |
| **直角** | `0px` | 侧栏导航行、表格及导航的 `3px` 竖向选择轨 |

- **边界绘制**：所有分割线与轮廓默认 `1px`。卡片通过 `::after` 伪元素内嵌描边，防止内容裁切及 `hover` 变色引起布局抖动。
- **选择轨**：`3px` 暖橙竖轨（`--ui-selection-rail-width`）专用于当前导航项、选中表格行、文件树选中行与校对当前上下文。
- **单侧气泡**：对话流中仅用户输入使用 `6px / 6px / 4px / 6px` 紧凑气泡（右对齐、最大宽 `75%`）；助手回答保持无外框的开放文本流。

### Named Rules

**The Small Radius Rule.** 工作面基础控件统一使用 `4px` 语义圆角，且源码须消费 `--ui-radius-*` token 而非硬编码 `4px / 8px / 999px` 字面量。

**The Selection Rail Rule.** `3px` 暖橙竖轨只表达明确的选中/当前交互状态，禁止用作静态卡片或提示块的装饰彩条。

**The One-Sided Bubble Rule.** 仅用户消息使用紧凑气泡；助手回答、思考与工具过程按结构化内容展开，禁止做成左右对称的社交聊天气泡。

## Components

### Buttons & Inline Actions

按钮手感紧凑、利落，业务代码统一通过 [`AppButton`](src/frontend/widgets/app-button.tsx) 消费，不直接导入底层 [`src/frontend/shadcn/button.tsx`](src/frontend/shadcn/button.tsx)。

| 变体 / 规格 | 表面与文字 | 关键细节 |
|---|---|---|
| `default` (Primary) | `primary` 底 + `primary-foreground` 文 | 仅用于主操作；悬停为 `primary` 90% 透明度 |
| `secondary` | `secondary` 底 + `secondary-foreground` 文 | 悬停混入 5% 前景色 |
| `outline` | 浅色 `background` + `border`；暗色 `input` 30% 底 | 悬停切至 `muted`（暗色 `input` 50% 底） |
| `ghost` / `link` | 透明底；`link` 使用 `primary` 文 | `ghost` 悬停显现 `muted`；`link` 悬停下划线 |
| `destructive` | `failure` 10% 浅底 + `failure` 文 + `failure` 30% 边 | 暗色底面升至 20%，不做高饱和满铺警报按钮 |
| 尺寸词表 | `xs` (`24px`)、`sm` (`28px`)、`default` (`32px`)、`lg` (`36px`)、`toolbar` (`36px`) | 默认 `13px` 字号、`10px` 水平内边距；`toolbar` 用 `12px` 字号与 `8px` 水平内边距 |

- **交互反馈**：预留 `1px` 透明边框，`focus-visible` 切为 `ring` 边框；非弹出型按钮 `active` 轻微下压 `1px`。
- **紧凑行内按钮** (`.inline-action-button`)：`24 × 24px` 仅图标入口，常态透明无边框，悬停或展开菜单时浮出 `0.5px` 细描边与 `8%` 前景自适应底色。
- **键帽** (`Kbd`)：高 `20px`、最小宽 `20px`、`12px` 字号，使用 `currentColor` 15% 低透明底色自适应任意宿主，禁止按外层容器覆写颜色；弹窗提交与禁用倒计时期间保持键帽占位稳定。

### Chips, Badges & Status Marks

- **信息胶囊** (`.app-badge`)：高 `20px`、胶囊圆角、`12px` / `500` 字重、`8px` 水平内边距、`0.5px` 细描边与 `tabular-nums`。
- **五种语义色调**：`neutral`（默认）、`brand`、`success`、`warning`、`failure`。彩色胶囊使用对应语义色 `14%` 混入 `popover` 作浅底、`35%` 混入 `border` 作描边，文字混入 `foreground`（`brand` 占 85%，其余占 50%）保证明暗主题下的小字对比度。
- **状态灯与倒计时环**：通用状态灯 (`.status-mark`) 为 `8px` 圆形，与 `CountdownRing`（`24px` / `12px`）及后台待回复标签共享 `1s ease-out` `6px` 扩散脉冲（70% 周期淡出）；启用 `prefers-reduced-motion: reduce` 时，状态灯保留 `3px` 静态光环，倒计时环隐藏扩散脉冲并保留进度与颜色切换（剩余 ≤ 25% 切 `warning`）。

### Cards & Containers

`Card` 提供四种变体，按职责分层避免重复套框：

- `default`：`--card` 底面，`16px` 内边距，承载独立内容任务。
- `group`：`--ui-group-surface` 底面，承载卡片或弹窗内部的静态信息分组。
- `table` / `toolbar`：分别收起底部或全部内边距，交由表格与命令栏自身控制边界。
- 可交互卡片（`data-interactive="true"`）悬停时外描边混入 `32%` 主色（`--ui-card-border-hover`），`focus-visible` 显示 `2px` 暖橙外轮廓。

### Inputs, Select & Segmented Controls

- **单行输入与选择框**：`Input` 与 `SelectTrigger` 统一高 `32px`（紧凑 `sm` 为 `28px`）、`4px` 圆角、`--ui-font-size-13` 字号、`popover` 承载面、`1px` `input` 边框。`focus-visible` 边框切为 `ring`；只读与禁用态切为 `muted` 50% 浅底；无效态使用 `destructive` 边框与 5% 红底。
- **局部分段标签** (`Tabs`)：容器高 `32px`、`muted` 底、`4px` 内边距；激活项高 `24px`、最小宽 `64px`、`popover` 面配极轻阴影。仅用于同一任务对象的局部视图切换（如工具输入与输出）。
- **单选分段开关** (`SegmentedToggle`)：选项高 `28px`、最小宽 `64px`、共享外框仅首尾 `4px` 圆角，选中项使用 `primary` 暖橙填充与 `primary-foreground` 文字。

### Dialogs, Overlays & Toasts

- **确认与动作决策弹窗** (`AppConfirmDialog` / `AppActionDialog`)：`popover` 底面、`6px` 圆角、最大宽 `480px`，顶部统一标题（或隐藏后以主操作提供无障碍名），底栏使用 `muted` 50% 浅底与顶分割线。主按钮统一主题色；高风险确认支持统一的 3 秒延迟倒计时。
- **页面级内容对话框** (`AppPageDialog`)：提供 `sm` (`560px`)、`md` (`720px`)、`lg` (`960 × 640px`)、`xl` (`1120 × 640px`)、`viewport` (`80vw × 80vh`) 五档规格，主体 `24px` 内边距、底栏 `muted` 50% 浅底。
- **快捷键约定**：普通弹窗支持 `Enter` 提交主操作，含多行输入的弹窗改用 `Ctrl+S` / `⌘S`，可关闭弹窗统一支持 `Esc`；表单保护态可通过 `escape-only` 屏蔽点击遮罩关闭。
- **Toast 与拖放覆盖层**：Sonner Toast 位于顶部居中（`top: 56px`），使用 `popover` 面、`4px` 圆角与可选取正文，错误明细在 `max-height: min(40vh, 320px)` 内可滚动。全页拖放（`.file-drop-zone__overlay`）激活时允许 `1px` 虚线暖橙边框、低透明渐变、微缩放到位与 `4px` 背景模糊；局部组件拖放（`.file-drop-overlay`）仅覆盖目标内部且不使用模糊。

### Navigation

- **侧栏导航**：每行高 `36px`、直角轮廓，图标列 `20px` 与单行省略标题组成。悬停与激活态显示 `sidebar-accent`（88% 混入 `sidebar`）底面，激活项左侧展开 `3px` 暖橙选择轨；工程列表项以状态灯区分关闭、已打开（绿）与忙碌（橙），行尾操作在悬停或聚焦时渐变浮现。
- **工程工作区顶栏**：左侧承载对话与文件预览标签（高 `30px`、`128–256px` 宽、激活项底部居中 `16 × 2px` 暖橙短轨）；右侧承载「工作台 / 翻译质量」双组入口，窄态点击向下展开浮层卡片，宽态（`≥ 1280px`）沉降为右侧无阴影常驻卡片。

### Tables & Production Editors

- **数据表格**：基础表头 `36px` / 行高 `39px`；虚拟化生产表 (`AppTable`) 调整为表头 `42px` / 行高 `36px`、`12px` 水平内边距，配备固定列宽、细列分割线、浅斑马纹与框选/拖拽浮层。选中行使用 `accent` 状态面与左侧 `3px` 暖橙选择轨，键盘焦点行额外混入 `16%` 主色。
- **代码与文本编辑器** (`AppEditor`)：基于 CodeMirror，`popover` 与 `background` 90/10 混色底面、`13px` / `1.7` 行高、`4px` 圆角，聚焦切回纯 `popover` 与 `ring` 边框。默认正文底留 `48px` 编辑缓冲、开启 `0.075em` 校对字距与细腻空白字符（空格圆点、全角空格线框、Tab 箭头）高亮；单行字段模式恢复 `0em` 字距且高度按 `max(32px, calc(var(--ui-font-size-13) * 1.5 + 12px))` 随字号伸缩；只读态柔化对比并隐藏光标，查看器态恢复 `0em` 字距。
- **通用文档与技能编辑器**：顶栏命令条（`40px` 最小高）+ 可选可调宽文件树（`30px` 行高、`3px` 选中轨）+ 全高 `AppEditor` 卡片；元数据字段名使用 `primary`，分隔符弱化，校验错误以失败红波浪下划线提示。

### Structured Reading & Agent Workspace

- **结构化阅读与选区**：应用壳层默认 `user-select: none`，但日志详情、校对上下文、Markdown、工具载荷与对话内容必须显式恢复 `user-select: text`，长内容采用 `pre-wrap` 与任意位置断行，滚动收敛在各自视口内。校对与展开日志在宽度充足时左右并列原文与译文，译文面允许混入 `5%` 主色，当前上下文行配 `3px` 暖橙选择轨。
- **开放式 Markdown**：基于 `AppMarkdown` + Streamdown，正文 `13px`（行高 `1.65`）。代码块、表格与 Mermaid 图统一复用 `popover` 面、`1px` 边界与 `36px` 弱色工具栏；GFM Alerts 与引用块仅使用 `1px` 语义色左边框与 `6%` 淡底，不用粗彩条。
- **对话过程与回合状态**：思考块（`32px` 折叠条、展开视口最高 `240px`）、工具调用行（`24px` 单行截断 + 行尾状态灯）与失败恢复行直接留在时间线内；回合底栏以中点串联状态、耗时与 TPS，容器宽 `≤ 360px` 时自动隐藏 TPS；左侧边缘提供 `6px` 悬浮圆点回合导航与 `320px` 悬停预览卡。
- **底部输入与决策区**：输入器（最大宽 `1120px`、最小高 `106px`、`popover` 面、`64–140px` 可滚输入区、`28px` 页脚工具行）与上方 `28px` 动态状态区（含排队列表、翻译摘要、空闲点星微扫光胶囊与圆形跟随按钮）共用底部组合区；主输入器悬停时在 `1px` 外边框呈现局部鼠标追随霓虹高光，聚焦切为暖橙边框。进入待决策状态时，状态区与输入器收起并平滑展开最大宽 `720px` 的决策卡，选项行仅以弱分割线分隔并共用右侧 `24px` 图标轨。
- **翻译进度摘要与命令栏**：Agent 摘要卡与文件页进度胶囊共享浅主色进度填充与绿/橙状态脉冲灯；页面重复操作集中在 `CommandBar`（高 `56px`、`12px` 水平内边距、组间距 `2px`、组分割线高 `20px`、右侧 `12px` 低对比提示）。

## Do's and Don'ts

### Do:

- **Do** 保持 [`src/frontend/index.css`](src/frontend/index.css) 作为全局 `--ui-*` 与主题 token 的唯一定义入口，页面与组件私有样式只消费不重定义。
- **Do** 通过 [`AppButton`](src/frontend/widgets/app-button.tsx) 消费产品按钮，并复用 `Card`、`AppTable`、`AppEditor`、`AppPageDialog`、`CommandBar` 等既有生产原语。
- **Do** 在 `src/frontend/app/`、`src/frontend/features/`、`src/frontend/pages/` 与 `src/frontend/widgets/` 中坚持 `px-first`（禁用 `rem`），字号统一消费 `--ui-font-size-*`，圆角统一消费 `--ui-radius-*`。
- **Do** 用暖橙低频标记主操作、选中轨、焦点与关键线索；用色面与 `1px` 细边组织常驻层级，用 `--ui-shadow-overlay` 区分浮层。
- **Do** 只在连续阅读与对话流组件内部收窄阅读栏（`1120px` 输入基准与 `1072px` 时间线），让表格、编辑器与页面壳层充分占满工作区。
- **Do** 为对话、Markdown、日志详情、校对上下文与工具载荷显式恢复文本选择，并将滚动锁定在对应容器内部。
- **Do** 让长链路状态同时具备文字、结构与颜色证据，并为所有动效提供 `prefers-reduced-motion: reduce` 降级表现。
- **Do** 修改前端样式或边界后运行 `npm run check`，验证 token 所有权、`px-first`、动态字号、圆角语义与导入分层。

### Don't:

- **Don't** 制造网页感：禁止浏览器式长页、营销 hero、大留白卡片信息流或通用后台管理模板布局。
- **Don't** 把「萌、极客、内敛」做成大面积插画、强主题拼色、高饱和粉紫或铺满界面的霓虹/常驻玻璃拟态（模糊仅限全页拖放与阻断进度遮罩，霓虹高光仅限主输入器悬停 `1px` 描边）。
- **Don't** 把 Agent 助手回答、思考与工具过程包成左右对称的社交聊天气泡或引入头像列。
- **Don't** 仅用脉冲点、颜色或瞬时 Toast 隐藏长链路过程；执行明细与失败记录必须留在可回溯的界面结构中。
- **Don't** 把 `3px` 暖橙选择轨借用作静态卡片、提示框或警告块的左侧装饰彩条（静态引用与 Alert 左边仅限 `1px`）。
- **Don't** 在页面或组件中硬编码固定像素字号、`rem` 尺寸字面量、`4px`、`8px` 或 `999px` 圆角字面量，以及高层级 `z-index` 数字。
- **Don't** 在 `DESIGN.md` 中复制业务规则清单或一次性页面文案；本文档只记录可复用的视觉系统与空间契约。
