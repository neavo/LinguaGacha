---
name: LinguaGacha
description: 原生桌面质感的 AI 文本翻译工具，萌、极客、内敛。
colors:
  background: "#f3f4f6"
  foreground: "#25272c"
  card: "#fbfcfd"
  card-foreground: "#25272c"
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
  sidebar: "#ebeef2"
  sidebar-accent: "#e1e5eb"
  success: "#22c55e"
  warning: "#f97316"
  failure: "oklch(0.61 0.18 28)"
  chart-amber: "#f2b84b"
  chart-coral: "#d85f42"
  chart-slate: "#7a8491"
  dark-background: "#111318"
  dark-foreground: "#eef1f5"
  dark-card: "#171a20"
  dark-primary: "#f49a51"
  dark-primary-foreground: "#2b1b0f"
  dark-secondary: "#20242b"
  dark-muted: "#1d2128"
  dark-accent: "#252a32"
  dark-border: "#343a44"
typography:
  display:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  headline:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0em"
  title:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0em"
  body:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  card: "4px"
  button: "8px"
  pill: "999px"
spacing:
  hairline: "1px"
  rail: "3px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  control: "32px"
  toolbar-button: "36px"
  titlebar: "40px"
  table-head: "42px"
  toolbar: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control}"
    padding: "0 10px"
  button-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.toolbar-button}"
    padding: "0 8px"
  toggle-segmented-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control}"
    padding: "0 10px"
  badge-brand:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.lg}"
  card-panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.xl}"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    height: "{spacing.control}"
    padding: "4px 10px"
  table-row:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    height: "36px"
    padding: "0 12px"
---

# Design System: LinguaGacha

## 1. Overview

**Creative North Star: "安静的本地炼金台"**

LinguaGacha 的视觉系统是一套原生桌面工具语言：稳定壳层、紧凑控件、明确表格工作面、低频暖橙反馈。它服务批量翻译、规则维护、校对和文件处理，不制造浏览式页面节奏。用户应先感到可控、清楚、可信，再从小图标、微动效、状态文案和暖色线索里感到一点萌和极客气。

当前项目已经从旧 `frontend/` 组织迁移到根目录运行：`src/renderer/index.css` 是全局 token 与 shadcn 主题入口，`src/renderer/shadcn/` 承接基础组件，`src/renderer/widgets/` 承接表格、编辑器、命令栏、文件拖放等生产工作面。页面 CSS 只负责页面布局和局部组合状态，不重新定义基础视觉。

**Key Characteristics:**
- 原生桌面客户端优先，固定标题栏、侧栏、工作区边界和即时反馈。
- 冷灰浅色为默认工作环境，暗色主题是同一工具语言的低照度变体。
- 暖橙来自应用图标，只用于主操作、选择轨、焦点、进度和少数图表线索。
- shadcn radix-nova 提供控件底座，自研 widgets 承接高密度生产工作面。
- 视觉装饰必须服务状态、选择、层级、可编辑性或任务反馈。

## 2. Colors

调色板是冷灰桌面底色加图标暖橙，兼容浅色和暗色主题。默认浅色主题用于长时间翻译和校对；暗色主题用于低照度环境，但不能变成霓虹、冷蓝科技风或终端拟态。

### Primary
- **图标暖橙主强调**：用于主按钮、当前导航轨、选中行轨、进度环、焦点环和关键可操作状态。它必须低频出现，像工具给出的线索，而不是品牌铺色。
- **暖米前景**：用于主强调色上的文字与图标，让主按钮和选中态保持清楚。

### Secondary
- **冷灰次级面**：用于次级按钮、分段切换未选中项、弱状态底和工具栏分区。
- **石墨次级文字**：用于次级控件、说明文字和弱层级标签，弱于正文但不能失焦。

### Tertiary
- **蜜黄图表色**：只作为图表、统计或进度分段的辅助色，不用于普通装饰。
- **珊瑚图表色**：只作为分类或图表辅助，不替代失败红。
- **钢灰图表色**：用于低优先级数据系列和背景统计。

### Neutral
- **冷灰背景**：应用主背景和工作区基底。
- **石墨前景**：正文、标题、图标默认色，避免纯黑带来的网页感。
- **近白冷灰卡片面**：卡片、弹层、表格头、输入和编辑器的承载面。
- **雾冷灰静音面**：hover、只读态、筛选区域和弱层级背景。
- **柔冷灰边框**：分割线、输入边框、表格线和卡片描边。
- **侧栏冷灰**：导航底座，与工作区形成轻微分区。

### Named Rules

**The Cool Desktop Rule.** 中性灰必须保持轻微蓝灰调，禁止纯黑、纯白和默认高饱和冷蓝。

**The Icon Glow Scarcity Rule.** 暖橙只用于选择、主操作、焦点、进度和状态线索；单屏大面积铺色会破坏内敛感。

**The Status Honesty Rule.** 成功绿、警告橙、失败红只表达状态，不参与装饰配色。

## 3. Typography

**Display Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif  
**Body Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif  
**Label/Mono Font:** LGMono

**Character:** 字体系统带一点代码编辑器气质，让路径、模型名、术语、翻译条目、日志和表格数字都显得可信。LGBaseFont 与系统中文字体负责中文可读性，不能走营销页展示字体路线。

### Hierarchy
- **Display**（400，42px，1）：只用于统计数字、关键计数和大号任务状态值。
- **Headline**（500，16px，1.3）：用于页面内重要分组标题、弹窗标题和覆盖层标题。
- **Title**（500，14px，1.25）：用于卡片标题、设置项标题、表格上方标题和侧栏品牌。
- **Body**（400，13px，1.5）：用于常规内容、表格单元格、说明文字和控件正文，长段落控制在 65 到 75 个字符以内。
- **Label**（500，12px，1.4）：用于表头、徽标、工具栏提示、状态说明和紧凑控件标签。

### Named Rules

**The Tool Text Rule.** 文字层级必须服务扫描和操作，禁止网页式超大标题和宣传口号占据工作面。

**The Zero Drama Spacing Rule.** 新增可见文本的 `letter-spacing` 默认使用 `0em`；只有编辑器特殊字符可视化等明确生产理由才允许局部偏离。

## 4. Elevation

LinguaGacha 使用低阴影加描边的混合层级。常驻结构靠背景色、1px 边框、分割线和壳层分区表达；阴影只给卡片、表格头、命令栏、拖拽浮层和覆盖层提供轻微浮起。文件拖放覆盖层可以使用淡渐变和 4px 模糊，因为它是临时状态反馈，不是默认玻璃拟态。

### Shadow Vocabulary
- **默认卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 14px 28px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`）：用于普通卡片和轻量容器。
- **面板卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent), 0 18px 32px -24px color-mix(in srgb, var(--foreground) 18%, transparent)`）：用于承载较多配置内容的面板卡片。
- **表格卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 4%, transparent), 0 10px 20px -24px color-mix(in srgb, var(--foreground) 12%, transparent)`）：用于数据表容器和表头。
- **工具栏卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 12px 24px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`）：用于命令栏、搜索栏和紧凑操作组。
- **覆盖层阴影**（`0 18px 48px -24px color-mix(in srgb, var(--foreground) 30%, transparent)`）：用于弹窗、浮层和需要暂时盖过工作区的界面。

### Named Rules

**The Quiet Lift Rule.** 阴影必须轻，主要表达层级和状态，不能承担装饰。

**The Border First Rule.** 常驻层级优先用 1px 描边和色面区分，只有交互、拖拽或覆盖层才增加明显阴影。

## 5. Components

### Buttons
- **Shape:** shadcn 按钮默认 8px 半径，工具型按钮高度 32px；标题栏和工具栏按钮保持 32px 到 36px。
- **Primary:** 暖橙背景、暖米文字，高度 32px，水平内边距 10px，图标通过 `data-icon` 交给组件控制尺寸。
- **Hover / Focus:** hover 只轻微加深或转为 muted 背景；focus 使用 ring 边框和 3px 半透明焦点环；active 允许 1px 下压。
- **Secondary / Ghost / Tertiary:** outline、secondary、ghost 用背景和边框变化表达层级，禁止渐变、厚阴影和页面私有重绘。

### Chips
- **Style:** 徽标高度 20px，999px 胶囊半径，12px 字号，品牌徽标使用低透明暖橙底和主色文字。
- **State:** 选中、筛选、状态徽标必须辅以文字、图标或明确语义，不只依赖颜色。

### Cards / Containers
- **Corner Style:** 卡片默认 4px，表格、工具栏、设置项都沿用小半径；不要把工作面做成大圆角网页卡片。
- **Background:** default、panel、table、toolbar 四种变体由 `src/renderer/index.css` 的 `data-slot="card"` 规则统一控制。
- **Shadow Strategy:** 使用 Elevation 中的低阴影，只有 `data-interactive="true"` 的卡片获得 hover 和 active 反馈。
- **Border:** 使用 1px 伪元素描边，hover 通过边框混入主色表达可操作性。
- **Internal Padding:** default 为 16px，panel 为 24px，table 和 toolbar 把 padding 让给内部结构。

### Inputs / Fields
- **Style:** 输入框高 32px，8px 半径，透明背景，1px input 边框，水平内边距 10px。
- **Focus:** focus-visible 使用 ring 边框；编辑器聚焦时切换到 popover 背景，反馈清楚但不浮夸。
- **Error / Disabled:** error 使用 failure 色边框和低透明红底；disabled 降低透明度并锁定指针。

### Navigation
- **Style:** 左侧桌面壳层导航展开约 256px，折叠约 48px；项目、任务、设置、质量和工具按组排列。
- **Active State:** 活跃项使用 3px 左侧选择轨和浅 accent 背景；hover 只出现轻量色面。
- **Motion:** 折叠、子项展开和选择轨使用 180 到 260ms 的 `cubic-bezier(0.22, 1, 0.36, 1)`。
- **Desktop Feel:** 导航项保持无圆角或极低圆角，避免网页标签页和移动端抽屉感。

### Tables
- **Structure:** 表头 36px 到 42px，行高 36px 到 39px，单元格水平内边距 12px，列分割线只用 1px 柔灰。
- **Selection:** 选中行使用浅 accent 背景和 3px selection rail；键盘焦点增强选中底色。
- **Density:** 表格是主要工作面，优先保证列对齐、文本截断、拖拽指示、虚拟滚动和选择框稳定。

### Editor
- **Style:** 编辑器使用 13px 字号、1.7 行高、4px 半径、1px 边框和 popover 混合背景。
- **Whitespace:** 空格、全角空格、制表符高亮必须细腻可见，服务校对和格式保留。
- **Readonly / Invalid:** 只读态降低前景和背景对比；无效态使用 failure 色，但不能覆盖文本可读性。

### Command Bar
- **Structure:** 命令栏最小高度 56px，水平内边距 12px，操作组间距 2px，组分割线高度 20px。
- **Behavior:** 命令栏服务重复操作，不承载说明型大段文案；提示文字保持 12px、右对齐、低对比。

### File Drop Overlay
- **Style:** 拖放激活时使用 1px 虚线暖橙边框、淡暖橙到 accent 的临时渐变、4px 模糊和 180ms 缩放反馈。
- **Limit:** 这个处理只属于拖放状态，不得扩散成常驻玻璃拟态背景。

## 6. Do's and Don'ts

### Do:
- **Do** 把设计权威放在 `DESIGN.md`，把代码 token 权威放在 `src/renderer/index.css`。
- **Do** 让 `src/renderer/shadcn/` 维护基础控件视觉，让 `src/renderer/widgets/` 维护生产工作面组件。
- **Do** 保持桌面客户端壳层：固定标题栏、侧栏、工作区边界、紧凑命令栏和可重复操作路径。
- **Do** 使用 4px 卡片半径、32px 基础控件高度、36px 工具栏按钮高度、12px 单元格内边距和 16px 页面节奏。
- **Do** 用暖橙表达主操作、选择轨、焦点、进度和关键状态线索。
- **Do** 在新增页面样式时遵守 px-first：尺寸字面量用 px，line-height 用无单位数值，letter-spacing 用 em。
- **Do** 运行 `npm run check` 检查页面层是否越权重定义全局 token 或使用 rem 尺寸字面量。

### Don't:
- **Don't** 制造“网页感”：不要让整体视觉、布局节奏和交互反馈像浏览器网页或 Web SaaS 套壳。
- **Don't** 使用网页式大留白、滚动长页、营销式 hero、卡片堆叠的信息流或后台管理模板气质。
- **Don't** 把可爱气质做成大面积插画、强主题装饰、高饱和粉紫或浮夸动效。
- **Don't** 使用渐变文字、默认玻璃拟态、重复图标卡片网格或 hero-metric 模板。
- **Don't** 在页面私有 CSS 中重定义 `--ui-*` token，新增全局 token 必须回到 `src/renderer/index.css`。
- **Don't** 用超过 1px 的侧边彩条装饰卡片、列表项、提示或警告；3px 选择轨只能用于导航、表格选中和明确交互状态。
- **Don't** 在新文档、脚本提示或样式说明里继续引用旧 `frontend/` 目录作为当前事实。
