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
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  title:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.018em"
  body:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
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
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
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
    backgroundColor: "{colors.accent}"
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
    backgroundColor: "transparent"
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
  file-drop-overlay:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: LinguaGacha

## Overview

**Creative North Star: "安静的本地炼金台"**

LinguaGacha 像一台可靠的本地炼金台：固定标题栏和侧栏围住工作区，紧凑命令区、稳定表格与编辑器承接反复操作。萌感来自小尺寸图标、温和状态文案、暖橙选择轨和轻微反馈；极客感来自等宽倾向字体、清楚的数据密度与可追踪的工作流。

视觉服务翻译、配置、校对和文件处理，不制造网页式浏览动线。全局 token 与主题入口位于 `src/frontend/index.css`，基础控件由 `src/frontend/shadcn/` 承接；widgets、features 与 pages 只消费 token，并在各自所有权内组合视觉、布局和状态。

**Key Characteristics:**

- 原生桌面客户端优先：固定壳层、侧栏、工作区边界和即时反馈。
- 冷灰浅色是默认长时间工作环境，暗色主题保持同一层级关系。
- 暖橙低频出现，只标记主操作、选择、焦点、进度和关键线索。
- 信息密度偏高，控件紧凑，表格与编辑器承担主要生产工作。
- 装饰必须服务状态、选择、层级、可编辑性、错误或任务反馈。

## Colors

调色板由冷蓝灰工作面与低频暖橙组成；暗色主题把同一语义映射到深石墨表面与更明亮的暖橙，不转向霓虹科技感。

### Primary

- **图标暖橙主强调**（`colors.primary` / `colors.dark-primary`）：用于主按钮、当前导航轨、选中行轨、进度跳段和关键可操作状态；它必须稀少，像工具给出的线索。
- **聚焦暖橙**（`colors.ring` / `colors.dark-ring`）：只用于键盘焦点、可操作边界与短时强调。
- **暖米强调前景**（`colors.primary-foreground` / `colors.dark-primary-foreground`）：保证主强调面上的文字和图标清楚。

### Secondary

- **冷灰次级面**（`colors.secondary` / `colors.dark-secondary`）：用于次级按钮、分段切换、弱状态背景和工具栏分区。
- **石墨次级文字**（`colors.secondary-foreground` / `colors.dark-secondary-foreground`）：用于次级控件和说明文字，弱于正文但保持可读。

### Tertiary

- **蜜黄图表色**（`colors.chart-amber`）：用于统计、进度分段和项目首页的文件类别辅助。
- **珊瑚图表色**（`colors.chart-coral`）：用于分类、项目入口或图表辅助，不能替代失败红。
- **钢灰图表色**（`colors.chart-slate`）：用于低优先级数据系列和辅助参照；暗色主题使用对应的 `dark-chart-*` 映射保持区分度。

### Status

- **状态绿**（`colors.success` / `colors.dark-success`）：只表达成功、完成或通过。
- **警告橙**（`colors.warning` / `colors.dark-warning`）：只表达需要注意但仍可继续的状态。
- **失败红**（`colors.failure` / `colors.dark-failure`）：只表达失败、破坏性操作和无效输入。

### Neutral

- **冷灰工作台**（`colors.background` / `colors.dark-background`）：应用主背景和工作区基底。
- **石墨正文**（`colors.foreground` / `colors.dark-foreground`）：正文、标题和图标默认色，避免纯黑纯白的生硬对比。
- **近白卡片与浮层**（`colors.card`、`colors.popover` / `colors.dark-card`）：卡片、弹层、表格头、输入和编辑器承载面。
- **雾灰静音面**（`colors.muted` / `colors.dark-muted`）：hover、只读态、筛选区和弱层级背景。
- **浅冷灰强调面**（`colors.accent` / `colors.dark-accent`）：选择、hover 与低强度分组状态。
- **柔冷灰边框**（`colors.border` / `colors.dark-border`）：分割线、输入边框、表格线和卡片描边。
- **侧栏与标题栏冷灰**（`colors.sidebar`、`colors.titlebar-surface` 及其暗色映射）：稳定桌面壳层，与工作区形成轻微分区。

### Named Rules

**The Cool Desktop Rule.** 中性灰必须保持轻微蓝灰调，禁止纯黑、纯白和默认高饱和冷蓝。

**The Icon Glow Scarcity Rule.** 暖橙只用于主操作、选择、焦点、进度和状态线索；单屏大面积铺色会破坏内敛气质。

**The Status Honesty Rule.** 成功绿、警告橙和失败红只表达状态，禁止参与普通装饰配色。

**The Scoped Exception Rule.** 模型供应商品牌色与 CodeMirror 语法色可以在各自边界内保持辨识度，但不得晋升为全局强调色或扩散到普通控件。

## Typography

**Display Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif

**Body Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif

**Label/Mono Font:** LGMono

**Character:** LGMono 使用 Monaspace Neon 的 400–700 可变字重、90% 尺寸校准与 `slnt -11` 斜体轴，给路径、模型名、术语、日志和表格数字带来代码编辑器气质。LGBaseFont 与系统中文字体负责中文可读性；用户关闭 LGBaseFont 后，回退栈保留 LGMono 与系统字体，仍避免营销页展示字体路线。

### Hierarchy

- **Display**（400，42px，1，-0.025em）：只用于统计数字、关键计数和大号任务状态值。
- **Headline**（500，16px，1.35，-0.02em）：用于重要分组、覆盖层标题和拖放状态文案。
- **Title**（500，14px，1.25，-0.018em）：用于卡片标题、设置项标题、表格上方标题和侧栏品牌。
- **Body**（400，13px，1.5，0em）：用于常规内容、表格单元格、说明文字和控件正文；长段落控制在 65 到 75 个字符以内。
- **Label**（500，12px，1.4，0em）：用于表头、徽标、工具栏提示、状态说明和紧凑控件标签。

### Named Rules

**The Tool Text Rule.** 文字层级必须服务扫描和操作，禁止网页式超大标题、宣传口号和展示字体占据工作面。

**The Production Spacing Rule.** 普通可见文本的字距保持克制；只有统计数字、标题和编辑器特殊字符可视化等生产理由允许明确偏离。

## Layout

主窗口以 1280 × 800px 为创建与最小尺寸基线，占满可用视口并锁定外层滚动；平台标题栏高度由宿主注入，缺省为 40px。标题栏下方采用固定侧栏加弹性工作区：侧栏展开 256px、折叠 72px；工作区四周使用 16px 内边距与 16px 主节奏，密集分组降到 12px 或 8px，滚动只发生在工作区和指定生产组件内部。

工作区左上角使用 8px 壳层圆角与 1px 顶边、左边分界，页面默认填满可用宽高，不套网页式居中内容容器。壳层背景只使用低对比径向与纵向渐变，维持工作区层次而不形成装饰焦点。项目首页在 1180px 和 760px 设置防御性窄视口收叠，但生产窗口不会低于 1280px；这些规则不是全局移动端体系，CSS 的 320px 最小宽度也只是 renderer 兜底。

### Named Rules

**The Fixed Shell Rule.** 标题栏、侧栏和工作区边界必须稳定；页面不得自行发明新的全页导航壳或浏览器式长页。

**The Dense Rhythm Rule.** 页面以 16px 为主节奏，生产组件内部按 12px、8px、4px 递减；大留白必须有明确的工作流理由。

## Elevation & Depth

LinguaGacha 使用低阴影、1px 描边和色面分层的混合层级。常驻壳层先靠背景、边框与分割线建立深度，卡片只获得环境式轻抬；明显阴影与模糊只属于弹层、拖放和模态反馈。暗色主题使用更深、更集中于黑色的阴影，但不改变层级语义。

### Shadow Vocabulary

- **默认卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 14px 28px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`）：普通卡片和轻量容器。
- **面板卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent), 0 18px 32px -24px color-mix(in srgb, var(--foreground) 18%, transparent)`）：承载较多配置内容的面板。
- **表格卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 4%, transparent), 0 10px 20px -24px color-mix(in srgb, var(--foreground) 12%, transparent)`）：数据表容器和表头。
- **工具栏卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 12px 24px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`）：命令栏、搜索栏和紧凑操作组。
- **覆盖层阴影**（`0 18px 48px -24px color-mix(in srgb, var(--foreground) 30%, transparent)`）：弹窗、浮层和暂时盖过工作区的界面。

### Named Rules

**The Quiet Lift Rule.** 阴影必须轻，主要表达层级和状态，不能承担装饰。

**The Border First Rule.** 常驻层级优先用 1px 描边和色面区分，只有交互、拖拽或覆盖层才增加明显阴影。

## Shapes

基础按钮、输入、卡片和编辑器使用小而明确的 4px 圆角；弹窗与独立浮层可升到 6px，工作区壳层转角为 8px，徽标、头像、滚动条和状态点使用 999px 胶囊。侧栏导航和表格选择轨保持直角，避免移动端卡片或网页标签气质。

边界默认是 1px；3px 竖向选择轨只属于当前导航、选中表格行和同等级交互状态。卡片描边由伪元素承担，避免内容裁切和 hover 时布局跳动。

### Named Rules

**The Small Radius Rule.** 4px 是工作面的默认圆角，6px 与 8px 只用于确有层级意义的浮层和壳层。

**The Selection Rail Rule.** 3px 暖橙轨是选择语义，不是通用装饰；非交互卡片和提示不得借用。

## Components

### Buttons

- **Shape:** 应用按钮默认高 32px、4px 圆角、13px 字号和 10px 水平内边距；标题栏按钮为 32px，工具栏按钮为 36px、12px 字号和 8px 水平内边距。
- **Primary:** 暖橙背景配暖米文字，只用于主操作。
- **Hover / Focus:** hover 轻微改变当前语义面；focus-visible 使用 ring 边框和 3px 半透明焦点环；非弹出型按钮 active 下压 1px。
- **Secondary / Ghost / Destructive:** outline、secondary 和 ghost 依靠背景与边框变化表达层级；destructive 使用低透明失败红底和失败红文字，不做满屏警报式高饱和填充。

### Chips

- **Style:** 徽标高 20px、999px 胶囊圆角、12px 字号和 8px 水平内边距；品牌徽标使用低透明暖橙底与主色文字。
- **State:** 选中、筛选和状态徽标必须辅以文字、图标或明确语义，禁止只依赖颜色。

### Cards / Containers

- **Corner Style:** default、panel、table 和 toolbar 共用 4px 小圆角。
- **Background:** 各变体由全局 card surface token 混合卡片与背景色，暗色主题保持同一层级顺序。
- **Shadow Strategy:** 使用 Elevation & Depth 中的低阴影；只有可交互卡片获得 hover、active 与 focus-visible 反馈。
- **Border:** 1px 伪元素描边；hover 仅把边框少量混入主色。
- **Internal Padding:** default 为 16px，panel 为 24px，table 和 toolbar 把 padding 让给内部结构。

### Inputs / Fields

- **Style:** 桌面输入框高 32px、14px 字号、4px 圆角、透明背景、1px input 边框和 10px 水平内边距。
- **Focus:** focus-visible 把边框切换为 ring；编辑器聚焦时同时切到 popover 背景。
- **Error / Disabled:** error 使用 failure 边框与低透明红底；disabled 降低透明度、冻结指针并使用弱 input 背景。

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
- **Readonly / Invalid:** 只读态降低前景与背景对比并隐藏光标；无效态使用 failure 色但保持文本可读。

### Command Bar

- **Structure:** 命令栏最小高 56px、水平内边距 12px，操作组间距 2px，组分割线高 20px。
- **Behavior:** 命令栏只承接重复操作；提示文字保持 12px、右对齐和低对比。

### File Drop Overlay

- **Style:** 拖放激活时使用 1px 虚线暖橙边框、淡暖橙到 accent 的临时渐变、4px 模糊和 180ms 缩放反馈。
- **Limit:** 该处理只属于拖放状态，禁止扩散成常驻玻璃拟态背景。

## Do's and Don'ts

### Do:

- **Do** 把 `DESIGN.md` 作为当前视觉系统的可移植快照，把实际全局 token 与主题实现留在 `src/frontend/index.css`。
- **Do** 让 `src/frontend/shadcn/` 维护基础控件，让 `src/frontend/widgets/` 维护可复用生产工作面。
- **Do** 保持固定标题栏、侧栏、工作区边界、紧凑命令栏和可重复操作路径。
- **Do** 先使用 4px 圆角、32px 基础控件、16px 页面节奏与 1px 边界，再按已记录的组件变体调整。
- **Do** 用暖橙表达主操作、选择轨、焦点、进度和关键状态线索。
- **Do** 在新增页面样式时遵守 px-first：尺寸字面量用 px，line-height 用无单位数值，letter-spacing 用 em。
- **Do** 为新增动效保留键盘可达性，并尊重系统减少动态效果偏好。
- **Do** 运行 `npm run check` 检查页面层是否越权重定义全局 token 或使用 rem 尺寸字面量。

### Don't:

- **Don't** 制造“网页感”：禁止浏览器式长页、营销 hero、卡片信息流和后台管理模板气质。
- **Don't** 用大留白、通用卡片网格或宣传型视觉层级稀释翻译、校对和文件操作。
- **Don't** 把可爱气质做成大面积插画、强主题装饰、高饱和粉紫或浮夸动效。
- **Don't** 使用渐变文字、常驻玻璃拟态、重复图标卡片网格或 hero-metric 模板。
- **Don't** 在页面私有 CSS 中重定义 `--ui-*` token；新增全局 token 必须回到 `src/frontend/index.css`。
- **Don't** 用超过 1px 的侧边彩条装饰卡片、列表项、提示或警告；3px 选择轨只用于明确交互状态。
- **Don't** 在新文档、脚本提示或样式说明里继续引用旧 `src/renderer/` 目录。
