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
  sidebar: "#ebeef2"
  sidebar-accent: "#e1e5eb"
  sidebar-border: "#d2d7df"
  titlebar-surface: "#f4f5f7"
  dark-background: "#111318"
  dark-foreground: "#eef1f5"
  dark-card: "#171a20"
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
  dark-sidebar: "#14171d"
  dark-sidebar-accent: "#20242b"
  dark-sidebar-border: "#303640"
  dark-titlebar-surface: "#121319"
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
  card: "4px"
  button: "4px"
  overlay: "6px"
  workspace-corner: "8px"
  pill: "999px"
spacing:
  boundary: "1px"
  selection-rail: "3px"
  card-padding: "16px"
  panel-padding: "24px"
  page-gap: "16px"
  dense-section-gap: "12px"
  dense-list-gap: "8px"
  control-height: "32px"
  sidebar-item-height: "38px"
  sidebar-expanded: "256px"
  sidebar-collapsed: "72px"
  toolbar-button-height: "36px"
  titlebar-height: "40px"
  table-head-height: "36px"
  table-row-height: "39px"
  app-table-head-height: "42px"
  app-table-row-height: "36px"
  toolbar-height: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "color-mix(in srgb, {colors.failure} 10%, transparent)"
    textColor: "{colors.failure}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "0 10px"
  button-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    height: "{spacing.toolbar-button-height}"
    padding: "0 8px"
  badge-brand:
    backgroundColor: "color-mix(in srgb, {colors.primary} 14%, transparent)"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-status:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
  card-panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.panel-padding}"
  card-table:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "0"
  input-default:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control-height}"
    padding: "4px 10px"
  editor-default:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "8px"
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.foreground}"
    height: "{spacing.sidebar-item-height}"
    padding: "0 14px 0 22px"
  app-table-row:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    height: "{spacing.app-table-row-height}"
    padding: "0 12px"
  command-bar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    height: "{spacing.toolbar-height}"
    padding: "0 12px"
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
  agent-composer:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "6px 6px 5px 12px"
  file-drop-overlay:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: LinguaGacha

## Overview

**Creative North Star: "安静的本地炼金台"**

LinguaGacha 像一台可靠的本地炼金台：固定标题栏和侧栏围住工作区，紧凑命令区、稳定表格、编辑器与对话时间线承接反复操作。萌感来自小尺寸图标、温和状态文案、暖橙选择轨和轻微反馈；极客感来自等宽倾向字体、清楚的数据密度与可追踪的工作流。

视觉服务翻译、配置、校对、文件处理、Agent 协作和系统详情阅读，不制造网页式浏览动线。长链路过程以状态行、可展开思考、工具详情和结构化结果逐层显露，不把系统行为伪装成普通聊天内容。全局 token 与主题入口位于 `src/frontend/index.css`，基础控件由 `src/frontend/shadcn/` 承接；widgets、features 与 pages 只消费 token，并在各自所有权内组合视觉、布局和状态。

**Key Characteristics:**

- 原生桌面客户端优先：固定壳层、侧栏、工作区边界和即时反馈。
- 冷灰浅色是默认长时间工作环境，暗色主题保持同一层级关系。
- 暖橙低频出现，只标记主操作、选择、焦点、进度和关键线索。
- 信息密度偏高，控件紧凑，表格与编辑器承担主要生产工作。
- 对话、日志和校对上下文保持可选取、可展开、可追踪，系统过程不藏进瞬时提示。
- 装饰必须服务状态、选择、层级、可编辑性、错误或任务反馈。

## Colors

调色板由冷蓝灰工作面与低频暖橙组成；暗色主题把同一语义映射到深石墨表面与更明亮的暖橙，不转向霓虹科技感。

### Primary

- **图标暖橙主强调** (`#ad5a17` / `#f49a51`): 用于主按钮、当前导航轨、选中行轨、进度跳段和关键可操作状态；它必须稀少，像工具给出的线索。
- **聚焦暖橙** (`#d97924` / `#f4a261`): 只用于键盘焦点、可操作边界与短时强调。
- **暖米强调前景** (`#fff7ed` / `#2b1b0f`): 保证主强调面上的文字和图标清楚。

### Secondary

- **冷灰次级面** (`#e8eaee` / `#20242b`): 用于次级按钮、分段切换、弱状态背景和工具栏分区。
- **石墨次级文字** (`#4d535d` / `#e8ebf0`): 用于次级控件和说明文字，弱于正文但保持可读。

### Tertiary

- **蜜黄图表色** (`#f2b84b` / `#ffb454`): 用于统计、进度分段和项目首页的文件类别辅助。
- **珊瑚图表色** (`#d85f42` / `#ee6f4d`): 用于分类、项目入口或图表辅助，不能替代失败红。
- **钢灰图表色** (`#7a8491` / `#8ea0b5`): 用于低优先级数据系列和辅助参照；暗色主题使用对应的 `dark-chart-*` 映射保持区分度。

### Status

- **状态绿** (`#22c55e` / `#4ade80`): 只表达成功、完成或通过。
- **警告橙** (`#f97316` / `#fb923c`): 只表达需要注意但仍可继续的状态。
- **失败红** (`oklch(0.61 0.18 28)` / `oklch(0.68 0.17 28)`): 只表达失败、破坏性操作和无效输入。

### Neutral

- **冷灰工作台** (`#f3f4f6` / `#111318`): 应用主背景和工作区基底。
- **石墨正文** (`#25272c` / `#eef1f5`): 正文、标题和图标默认色，避免纯黑纯白的生硬对比。
- **近白卡片与浮层** (`#fbfcfd` / `#171a20`): 卡片、弹层、表格头、输入和编辑器承载面。
- **雾灰静音面** (`#e5e7eb` / `#1d2128`): hover、只读态、筛选区和弱层级背景。
- **浅冷灰强调面** (`#eef0f3` / `#252a32`): 选择、hover 与低强度分组状态。
- **柔冷灰边框** (`#d6dae0` / `#343a44`): 分割线、输入边框、表格线和卡片描边。
- **侧栏与标题栏冷灰** (`#ebeef2` / `#14171d`, `#f4f5f7` / `#121319`): 稳定桌面壳层，与工作区形成轻微分区。

### Named Rules

**The Cool Desktop Rule.** 中性灰必须保持轻微蓝灰调，禁止纯黑、纯白和默认高饱和冷蓝。

**The Accent Scarcity Rule.** 暖橙只用于主操作、选择、焦点、进度和状态线索；单屏大面积铺色会破坏内敛气质。

**The Status Honesty Rule.** 成功绿、警告橙和失败红只表达状态，禁止参与普通装饰配色。

**The Scoped Exception Rule.** 模型供应商品牌色与 CodeMirror 语法色可以在各自边界内保持辨识度，但不得晋升为全局强调色或扩散到普通控件。

## Typography

**Emoji Font:** Twemoji

**Display Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif

**Body Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif

**Label/Mono Font:** LGMono

**Character:** Twemoji 位于全局字体栈首位并统一彩色 emoji；字体资产的默认 cmap 只公开 Unicode Emoji 与 Emoji_Component，不公开空白、私用字符和普通 keycap base。`0–9`、`#` 与 `*` 的 FE0F UVS 使用可见的 LGMono 组件，完整 keycap 再由 GSUB 合成为 Twemoji，因此普通文本、显式 presentation 与复合序列均保持可见。LGMono 使用 Monaspace Neon 的 400–700 可变字重、90% 尺寸校准与 `slnt -11` 斜体轴，给路径、模型名、术语、日志和表格数字带来代码编辑器气质。LGBaseFont 与系统中文字体负责中文可读性；对话 Markdown、校对上下文与结构化日志继续使用同一字族，只通过行高和局部层级提高可读性，不另造内容字体。用户关闭 LGBaseFont 后，只移除该正文字体，仍保留 Twemoji、LGMono 与系统字体。

### Hierarchy

- **Display** (400, 42px, 1, -0.025em): 只用于统计数字、关键计数和大号任务状态值。
- **Headline** (500, 16px, 1.35, -0.02em): 用于重要分组、覆盖层标题和拖放状态文案。
- **Title** (500, 14px, 1.25, -0.018em): 用于卡片标题、设置项标题、表格上方标题和侧栏品牌。
- **Body** (400, 13px, 1.5, 0em): 用于常规内容、表格单元格、说明文字和控件正文；对话、校对上下文和结构化详情可把行高提高到 1.6–1.7，内容宽度由所属生产组件统一控制，不对子元素重复限宽。
- **Label** (500, 12px, 1.4, 0em): 用于表头、徽标、工具栏提示、状态说明和紧凑控件标签；耗时、行号、上下文用量与统计值使用等宽数字。

### Named Rules

**The Tool Text Rule.** 文字层级必须服务扫描和操作，禁止网页式超大标题、宣传口号和展示字体占据工作面。

**The Production Spacing Rule.** 普通可见文本的字距保持克制；只有统计数字、标题和编辑器特殊字符可视化等生产理由允许明确偏离。

**The Measured Data Rule.** 耗时、进度、行号、上下文用量和统计数字必须使用 `tabular-nums`，让状态更新时保持基线稳定。

## Layout

主窗口以 1280 × 800px 为创建与最小尺寸基线，占满可用视口并锁定外层滚动；平台标题栏高度由宿主注入，缺省为 40px。标题栏下方采用固定侧栏加弹性工作区：侧栏展开 256px、折叠 72px；工作区四周使用 16px 内边距与 16px 主节奏，密集分组降到 12px 或 8px，滚动只发生在工作区和指定生产组件内部。

工作区左上角使用 8px 壳层圆角与 1px 顶边、左边分界，页面默认填满可用宽高，不套网页式居中内容容器。壳层背景只使用低对比径向与纵向渐变，维持工作区层次而不形成装饰焦点。项目首页在 1180px 和 760px 设置防御性窄视口收叠，但生产窗口不会低于 1280px；这些规则不是全局移动端体系，CSS 的 320px 最小宽度也只是 renderer 兜底。

只有连续阅读会从满幅工作面中切出内部阅读栏：Agent 时间线与连接状态以输入器的 1120px 工作宽度为基准，向内收窄 48px，最大宽度为 1072px；空态任务建议限制为 520px。输入器仍固定在同一工作面底部，滚动只属于上方对话区。表格、编辑器、校对上下文和结构化日志继续按任务需要利用可用宽度，展开详情时才把原文、译文或术语字段并列。

### Named Rules

**The Fixed Shell Rule.** 标题栏、侧栏和工作区边界必须稳定；工作区已提供边界时，填满工作区的页面根节点不得重复形成卡片外框，也不得自行发明新的全页导航壳或浏览器式长页。

**The Dense Rhythm Rule.** 页面以 16px 为主节奏，生产组件内部按 12px、8px、4px 递减；大留白必须有明确的工作流理由。

**The Internal Reading Lane Rule.** 窄栏只能是满幅生产工作面内部的阅读组件，不能把整个页面改造成网页式居中内容容器。

## Elevation & Depth

LinguaGacha 使用低阴影、1px 描边和色面分层的混合层级。常驻壳层先靠背景、边框与分割线建立深度，卡片只获得环境式轻抬；Agent 工具、思考、上下文压缩和失败恢复等行内过程依靠弱色面、细边界与状态标记分层，不额外浮起。明显阴影与模糊只属于弹层、拖放和模态反馈。暗色主题使用更深、更集中于黑色的阴影，但不改变层级语义。

Portal 浮层遵循固定语义栈：Dialog 与 Sheet 使用 `--ui-layer-overlay`，Select、Dropdown、Context Menu 与 Popover 使用 `--ui-layer-popover`，通用及编辑器 Tooltip 使用 `--ui-layer-tooltip`，阻断式进度遮罩与反馈使用 `--ui-layer-blocking-overlay` / `--ui-layer-blocking-feedback`。层级关系固定为 `overlay < popover < tooltip < blocking`；页面不得复制高层级数字，子元素的局部 `z-index` 也不承担跨 Portal 排序。

### Shadow Vocabulary

- **默认卡片阴影** (`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 14px 28px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`): 普通卡片和轻量容器。
- **面板卡片阴影** (`0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent), 0 18px 32px -24px color-mix(in srgb, var(--foreground) 18%, transparent)`): 承载较多配置内容的面板。
- **表格卡片阴影** (`0 1px 2px color-mix(in srgb, var(--foreground) 4%, transparent), 0 10px 20px -24px color-mix(in srgb, var(--foreground) 12%, transparent)`): 数据表容器和表头。
- **工具栏卡片阴影** (`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 12px 24px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`): 命令栏、搜索栏和紧凑操作组。
- **覆盖层阴影** (`0 18px 48px -24px color-mix(in srgb, var(--foreground) 30%, transparent)`): 弹窗、浮层和暂时盖过工作区的界面。

### Named Rules

**The Quiet Lift Rule.** 阴影必须轻，主要表达层级和状态，不能承担装饰。

**The Border First Rule.** 常驻层级优先用 1px 描边和色面区分，只有交互、拖拽或覆盖层才增加明显阴影。

**The Inline Process Rule.** 行内系统过程保持贴合信息流；只有打开工具详情、引用菜单或模态内容时才提升到覆盖层。

## Shapes

基础按钮、输入、卡片和编辑器使用小而明确的 4px 圆角；弹窗与独立浮层可升到 6px，工作区壳层转角为 8px，徽标、头像、滚动条和状态点使用 999px 胶囊。侧栏导航和表格选择轨保持直角，避免移动端卡片或网页标签气质。

边界默认是 1px；3px 竖向选择轨只属于当前导航、选中表格行和同等级交互状态。卡片描边由伪元素承担，避免内容裁切和 hover 时布局跳动。用户消息允许使用 6px 主圆角与 4px 收尾角形成轻微方向感；助手输出保持开放文本流，不复制气泡轮廓。

### Named Rules

**The Small Radius Rule.** 4px 是工作面的默认圆角，6px 与 8px 只用于确有层级意义的浮层和壳层。

**The Selection Rail Rule.** 3px 暖橙轨是选择语义，不是通用装饰；非交互卡片和提示不得借用。

**The One-Sided Bubble Rule.** 只有用户输入使用紧凑消息气泡；助手回答、思考和工具过程必须按内容结构展开，禁止做成左右对称的社交聊天界面。

## Components

### Buttons

- **Shape:** 应用按钮默认高 32px、4px 圆角、13px 字号和 10px 水平内边距；标题栏按钮为 32px，工具栏按钮为 36px、12px 字号和 8px 水平内边距。
- **Primary:** 暖橙背景配暖米文字，只用于主操作。
- **Hover / Focus:** hover 轻微改变当前语义面；按钮预留 1px 边框，focus-visible 把边框切换为 ring；非弹出型按钮 active 下压 1px。
- **Secondary / Ghost / Destructive:** outline、secondary 和 ghost 依靠背景与边框变化表达层级；destructive 使用低透明失败红底、失败红文字和低强度失败红 1px 边框，不做满屏警报式高饱和填充。
- **Shortcuts:** 操作只在快捷键有效时显示键帽并声明 `aria-keyshortcuts`；Tooltip 使用动作或状态文案加右侧键帽，多行提示统一对齐。中点只分隔标题与当前值。
- **State Tooltips:** 控件 Tooltip 使用完整的本地化“标题 · 当前值”；布尔选项显示“启用 / 禁用”，布尔状态显示“已启用 / 已禁用”；布尔切换控件的可访问名称保持稳定，并由 `aria-pressed` 表达开关状态。

### Dialogs

- **Confirmation:** 正文使用“是否确认……”时固定显示“取消 / 确认”，确认按钮使用主题色，不按操作对象改写文案或颜色。
- **Decision:** 只有存在多个真实处理路径时才使用动作模态窗；标题默认沿用“确认”，只有确有独立标题时才显式提供。所有可关闭的动作模态窗固定显示“取消”，其它按钮直接命名操作结果，破坏性选项可以使用 failure 语义。
- **Necessity:** 不能提供恢复、替代或其它有效选择的风险提示不得阻断用户，交由当前工作流直接处理并使用既有错误反馈。

### Chips

- **Style:** 徽标高 20px、999px 胶囊圆角、12px 字号和 8px 水平内边距；品牌徽标使用低透明暖橙底与主色文字。
- **State:** 选中、筛选和状态徽标必须辅以文字、图标或明确语义，禁止只依赖颜色。

### Tabs

- **Structure:** 局部分段容器高 32px、4px 圆角、muted 背景和 4px 内边距；触发项高 24px、最小宽 64px、12px 字号和 12px 水平内边距。
- **Active / Focus:** 激活项使用 popover 面、正文色和极轻阴影；键盘焦点使用 1px 实线轮廓，不放大或位移。
- **Limit:** Tabs 只切换同一任务对象的局部视图，例如工具输入与输出；不得替代侧栏主导航或制造网页式页签栏。

### Cards / Containers

- **Corner Style:** default、panel、table 和 toolbar 共用 4px 小圆角。
- **Background:** 各变体由全局 card surface token 混合卡片与背景色，暗色主题保持同一层级顺序。
- **Shadow Strategy:** 使用 Elevation & Depth 中的低阴影；只有可交互卡片获得 hover、active 与 focus-visible 反馈。
- **Border:** 1px 伪元素描边；hover 仅把边框少量混入主色。
- **Internal Padding:** default 为 16px，panel 为 24px，table 和 toolbar 把 padding 让给内部结构。

### Inputs / Fields

- **Style:** 桌面输入框高 32px、14px 字号、4px 圆角、popover 承载面、1px input 边框和 10px 水平内边距。
- **Focus:** focus-visible 把边框切换为 ring；编辑器聚焦时同时切到 popover 背景。
- **Readonly / Disabled / Error:** readonly 与 disabled 使用弱 muted 承载面，disabled 同时降低透明度并冻结指针；error 使用 failure 边框与低透明红底。

### Navigation

- **Structure:** 左侧桌面导航展开 256px、折叠 72px；主项高 38px，折叠态图标按钮为 40px。
- **Active State:** 活跃项使用 3px 左侧选择轨和浅 accent 背景；hover 只增加轻量色面，父级活跃态降低轨与背景强度。
- **Motion:** 色面和透明度反馈通常使用 `180ms ease`；选择轨变形使用 220ms、壳层折叠和子项展开使用 260ms，后二者采用 `cubic-bezier(0.22, 1, 0.36, 1)`。
- **Desktop Feel:** 导航项保持直角，不转成网页标签或移动端抽屉。

### Tables

- **Base Table:** 基础表格表头高 36px、行高 39px、单元格水平内边距 12px。
- **Production AppTable:** 虚拟化生产表格覆写为表头 42px、行高 36px，并使用固定列布局、细列分割、斑马纹、拖拽指示和键盘焦点。
- **Selection:** 选中行使用浅 accent 状态面和 3px 暖橙选择轨；键盘焦点进一步混入少量主色。

### Editor

- **Style:** 编辑器使用 13px 字号、1.7 行高、4px 圆角、1px 边框和 popover 混合背景。
- **Whitespace:** 空格、全角空格和制表符高亮细腻可见，服务校对与格式保留；普通编辑器内容允许 0.075em 字距，单行字段恢复为 0em。
- **Readonly / Viewer / Invalid:** 只读态降低前景与背景对比并隐藏光标；viewer 恢复 0em 字距并按原始内容决定换行；无效态使用 failure 色但保持文本可读。

### Structured Reading Surfaces

- **Text:** 日志详情、校对上下文和 Agent 工具载荷使用 12–13px 字号、1.55–1.7 行高、`pre-wrap` 与任意位置断行；原始载荷查看器可切换保留换行或自动折行。
- **Selection:** 应用壳层默认不可选择，但正文、日志、上下文、Markdown、工具详情和编辑器必须显式恢复文本选择。
- **Pairing:** 原文与译文、术语字段只在展开详情且宽度足够时并列；译文面允许混入 5% 主色，当前上下文仍以 3px 选择轨标识。
- **Long Content:** 长日志条目使用可见内容布局优化，编号、耗时和行号使用等宽数字；滚动发生在详情内部，不扩张外层窗口。

### Agent Conversation

- **Frame:** 工作区壳层拥有页面外边界；对话页根节点填满工作区，只承接布局与滚动，不形成第二层卡片。输入器工作面最大宽 1120px，时间线向内收窄 48px 后最大宽 1072px，空态引导列最大宽 520px；时间线在内部滚动，输入器作为独立操作表面保留边界。
- **Message Roles:** 用户消息右对齐、最大宽 75%，使用紧凑 muted 气泡；暗色主题可混入 22% 主色。助手回答保持无外框的开放 Markdown，不配头像列或对称气泡。
- **Markdown:** 正文使用 13px / 1.65 并填满 1072px 消息列，不对子元素二次限宽；一级、二级标题复用 16px Headline 与 14px Title，三级到六级标题使用紧凑 13px Body；代码、表格和 Mermaid 图使用 popover 面与 1px 边界承载。带显式语言标记的普通代码块在顶边显示原始标记的弱层级语言标签，不推断或维护别名映射；完整消息中的 Mermaid 直接在信息流内展示，并提供可选的 `xl` 预览模态页，模态页复用已生成 SVG 而不重复渲染；流式 Mermaid、无语言和未知语言代码块保持可复制的纯文本回退，完整 Mermaid 只有解析或渲染失败时才显示源码回退。
- **Process Entries:** 普通工具、思考、上下文压缩与失败恢复行保持紧凑、可扫描的状态语义。Todo 只在输入器上方的紧凑状态条展示队首；标签与余项计数按内容占宽，队首获得状态条的剩余空间并在空间不足时截断，整条触发的 Tooltip 完整承载全部待办。运行态使用暖橙弧段圆环，减少动态效果时保留弧段但停止旋转。

### Agent Composer

- **Structure:** 输入器与动态待办状态条共用对话工作面底部组合区，操作区最大宽 1120px，状态条空时不占位；状态行高 28px，输入器使用 4px 圆角、1px 边界、popover 背景与紧凑内边距，操作表面最小高 106px。
- **Editor:** CodeMirror 输入区最小高 64px、最大高 140px、13px / 1.5，超出后内部滚动；页脚与独立操作统一高 28px，发送、停止与跟随最新使用圆形，发送与换行快捷键由发送按钮 Tooltip 渐进展示，队列行内操作高 24px，承接附件、模型、思考等级、上下文用量和发送操作。
- **Queue:** 输入队列在容器宽度 520px 以下隐藏附件列；输入队列和回到最新控件共享固定侧轨，Todo 状态条按自身内容关系布局。
- **References / Attachments:** 技能与术语引用使用低透明暖橙 token，不退化为裸文本；图片与响应批注附件共享中性外壳，分别使用方形缩略图和紧凑行。
- **Focus / Menus:** focus-within 只把边界切换为主色；引用候选菜单使用 popover、覆盖层阴影和高亮行，图片拖入只在输入器内部显示虚线临时覆盖层。

### Agent Decision

- **Frame:** Agent 使用占满 WorkspaceFrame 的页面画布，页面布局模式在导航时立即切换。透明定位层覆盖底部控制区，可见模态面通过独立效果层同时渐入色彩与背景模糊，以决策框的真实上缘为透明起点，横向贴齐页面边缘并延伸至页面底边。决策框最大宽 720px，在模态面中居中贴近底部，底部保留 16px 间距，并使用 popover 面、1px 边界、4px 圆角和覆盖层阴影；窄窗口为面板保留 16px 横向安全边距，二至三个固定选项和自定义输入在面板中完整展示。
- **Question:** 顶部标题由主题色语义图标和等大的 14px 问题组成，可选 12px 共同说明位于下一行；普通选择使用 `CircleQuestionMark`，取消按钮位于统一的 24px 尾部图标轨。固定选项是开放动作行，仅以弱分割线组织；每行依次使用序号胶囊、单行截断的常规字重 13px 动作标签和圆形箭头操作位。第一项的箭头外框从完整主题色开始按五分钟期限逐秒缩短，并以持续向外扩散的淡化圆环提示等待中的决定；剩余四分之一时，期限与提示圆环共同切换为 warning 语义，减少动态效果时隐藏扩散环并保留期限与颜色状态。
- **Actions:** 点击固定选项立即提交；自定义答案使用“自定义”胶囊、单行输入和圆形箭头按钮组成同一行，底部间距只由决策面内边距提供。标题取消、固定选项箭头与自定义提交共用尾部图标轨。写入授权使用 `Save` 图标和固定标题“正在写入工程数据”，说明区按业务顺序列出所有非零变更类别，数量使用主题色等宽数字并在需要时换行；下方只显示拒绝、允许本次、允许本次及本会话后续全部写入三个即时动作，控件不声明专用快捷键。

### Command Bar

- **Structure:** 命令栏最小高 56px、水平内边距 12px，操作组间距 2px，组分割线高 20px。
- **Behavior:** 命令栏只承接重复操作；提示文字保持 12px、右对齐和低对比。

### File Drop Overlay

- **Style:** 全页文件拖放激活时使用 1px 虚线暖橙边框、淡暖橙到 accent 的临时渐变、4px 模糊和 180ms 缩放反馈；输入器图片拖放只覆盖组件内部，不使用模糊。
- **Limit:** 两种处理都只属于拖放状态，禁止扩散成常驻玻璃拟态背景。

## Do's and Don'ts

### Do:

- **Do** 把 `DESIGN.md` 作为当前视觉系统的可移植快照，把实际全局 token 与主题实现留在 `src/frontend/index.css`。
- **Do** 让 `src/frontend/shadcn/` 维护基础控件，让 `src/frontend/widgets/` 维护可复用生产工作面。
- **Do** 保持固定标题栏、侧栏、工作区边界、紧凑命令栏和可重复操作路径。
- **Do** 先使用 4px 圆角、32px 基础控件、16px 页面节奏与 1px 边界，再按已记录的组件变体调整。
- **Do** 用暖橙表达主操作、选择轨、焦点、进度和关键状态线索。
- **Do** 只在长内容阅读组件内部使用 1072px 阅读栏（由 1120px 操作区向内收窄 48px），表格、编辑器和页面壳层继续占满工作面。
- **Do** 让日志、校对上下文、对话内容和工具载荷可选取，并把滚动约束在对应生产组件内部。
- **Do** 让 Agent 的运行、成功、失败、压缩与失败恢复同时拥有文字、结构和颜色证据。
- **Do** 在新增页面样式时遵守 px-first：尺寸字面量用 px，line-height 用无单位数值，letter-spacing 用 em。
- **Do** 为新增动效保留键盘可达性，并尊重系统减少动态效果偏好。
- **Do** 运行 `npm run check` 检查页面层是否越权重定义全局 token 或使用 rem 尺寸字面量。

### Don't:

- **Don't** 制造“网页感”：禁止浏览器式长页、营销 hero、卡片信息流和后台管理模板气质。
- **Don't** 用大留白、通用卡片网格或宣传型视觉层级稀释翻译、校对和文件操作。
- **Don't** 把可爱气质做成大面积插画、强主题装饰、高饱和粉紫或浮夸动效。
- **Don't** 使用渐变文字、常驻玻璃拟态、重复图标卡片网格或 hero-metric 模板。
- **Don't** 把 Agent 助手回答、思考与工具调用都包成同构气泡，或引入头像列、社交聊天式左右对称布局。
- **Don't** 只用脉冲点、颜色或瞬时 toast 表达长链路状态；过程必须留在信息流中并允许查看详情。
- **Don't** 把内部阅读窄栏扩张成全局居中页面模板。
- **Don't** 在页面私有 CSS 中重定义 `--ui-*` token；新增全局 token 必须回到 `src/frontend/index.css`。
- **Don't** 用超过 1px 的侧边彩条装饰卡片、列表项、提示或警告；3px 选择轨只用于明确交互状态。
- **Don't** 在新文档、脚本提示或样式说明里复用已迁移的旧目录名；统一链接当前 `src/frontend/` 入口。
