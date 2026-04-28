---
name: LinguaGacha
description: 原生桌面质感的 AI 文本翻译工具，萌、极客、内敛。
colors:
  background: "#f3f4f6"
  foreground: "#25272c"
  card: "#fbfcfd"
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
  sidebar-primary: "#ad5a17"
  success: "#22c55e"
  warning: "#f97316"
  failure: "#dc3f36"
typography:
  display:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
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
  label:
    fontFamily: "LGMono, LGBaseFont, Segoe UI, Microsoft YaHei UI, PingFang SC, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  card: "4px"
  button: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.card}"
    height: "32px"
    padding: "0 10px"
  button-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    height: "36px"
    padding: "0 8px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "16px"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    height: "32px"
    padding: "4px 10px"
  badge-brand:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
---

# Design System: LinguaGacha

## 1. Overview

**Creative North Star: "安静的本地炼金台"**

LinguaGacha 的视觉系统应像一款长期驻留在桌面上的本地工具：紧凑、稳定、可重复操作，同时在细节里保留一点萌感和极客气。它不是网页套壳，也不是 SaaS 后台模板；用户打开它时应该先感到可控、清楚、可信，再从图标、动效、微文案和微小强调色里感到轻微的俏皮。

界面采用浅色冷灰为主、来自应用图标的暖橙作为低频强调。壳层、侧栏、表格、工具栏和编辑器构成主要视觉语言，信息密度应接近原生桌面客户端。页面不追求滚动叙事，也不使用宣传式 hero；主要内容应直接服务翻译、配置、校对、规则维护和文件处理。

**Key Characteristics:**
- 原生桌面客户端优先，稳定壳层、明确工具区、即时反馈。
- 冷灰底色加图标暖橙强调，强调色稀缺使用。
- 4px 小半径卡片和紧凑控件让界面保持工具感。
- LGMono 与 LGBaseFont 组成技术感字体栈，兼顾中文和代码式信息。
- 视觉装饰必须服务状态、选择、层级或操作反馈。

## 2. Colors

调色板是克制的桌面冷灰与图标暖橙，不走冷蓝科技风，也不把可爱气质做成高饱和主题。图标里的蜜黄、橙光和珊瑚红只作为操作、选择和少量分类线索出现，不能变成大面积装饰。

### Primary
- **图标暖橙主强调**：用于主按钮、当前导航轨、选中状态、关键进度和需要用户注意的可操作元素。它取自图标阴影侧的深橙，应该少量出现，保持“工具正在给出线索”的感觉，而不是把屏幕染成品牌色。
- **暖米前景**：用于主强调色上的文字和图标，保证按钮与选中态足够清楚。

### Secondary
- **冷灰次级面**：用于次级按钮、辅助控件和轻量状态底色，提供桌面控件的可触感。
- **石墨次级文字**：用于次级控件上的文字，弱于正文但不失焦。

### Tertiary
- **成功绿**：只表示完成、通过、成功导入等正向状态。
- **警告橙**：只表示需要注意但尚未失败的状态。
- **失败红**：只表示错误、失败、危险操作和无效输入。

### Neutral
- **冷灰背景**：应用主背景，承载壳层和页面基底。
- **石墨前景**：正文、标题、图标默认色，避免纯黑造成网页或后台模板感。
- **近白冷灰卡片面**：卡片、弹层、表格容器和输入承载面。
- **雾冷灰静音面**：用于 hover、筛选面板、只读编辑器和弱层级背景。
- **柔冷灰边框**：用于卡片描边、分割线、输入边框和表格线。
- **侧栏冷灰**：用于导航底座，和主工作区形成轻微分区。

### Named Rules

**The Cool Desktop Rule.** 中性灰必须保持冷静、轻微带蓝灰调，不使用纯黑、纯白或默认冷蓝高饱和色。

**The Icon Glow Scarcity Rule.** 图标暖橙只用于选择、主操作、状态线索和少数图表语义；蜜黄与珊瑚红只作为局部分类辅助，单屏大面积铺色会破坏内敛感。

**The Status Honesty Rule.** 绿、橙、红只表达状态，不参与装饰配色。

## 3. Typography

**Display Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif  
**Body Font:** LGMono，回退到 LGBaseFont、Segoe UI、Microsoft YaHei UI、PingFang SC、system-ui、sans-serif  
**Label/Mono Font:** LGMono

**Character:** 字体系统带一点代码编辑器气质，但通过 LGBaseFont 和系统中文字体保持可读。它应让翻译条目、模型名、路径、术语和日志都显得清楚、可信，而不是像营销页面的展示字体。

### Hierarchy
- **Display**（400，42px，1）：只用于统计数字、关键计数和大号状态值。
- **Headline**（500，16px，1.3）：用于页面内重要分组标题和弹窗标题。
- **Title**（500，14px，1.25）：用于卡片标题、设置项标题和表格上方的小标题。
- **Body**（400，13px，1.5）：用于常规内容、表格单元格、说明文字和控件正文，长段落控制在 65 到 75 个字符以内。
- **Label**（500，12px，1.4）：用于工具栏提示、表头、徽标和紧凑控件标签。

### Named Rules

**The Tool Text Rule.** 文字层级必须服务扫描和操作，不使用网页式超大标题制造戏剧感。

**The Dense But Kind Rule.** 信息可以紧凑，但每个可操作区域都要保留清楚焦点、悬停和禁用状态。

## 4. Elevation

LinguaGacha 使用“低阴影加描边”的混合层级。静态界面主要靠背景色、边框、分割线和壳层分区表达结构；阴影只给卡片、表格头、工具栏和弹层提供轻微浮起感。hover 可以增强边框和阴影，但不应让元素像网页卡片一样漂浮。

### Shadow Vocabulary
- **默认卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 14px 28px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`）：用于普通卡片和轻量容器。
- **面板卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent), 0 18px 32px -24px color-mix(in srgb, var(--foreground) 18%, transparent)`）：用于承载较多内容的设置面板。
- **表格卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 4%, transparent), 0 10px 20px -24px color-mix(in srgb, var(--foreground) 12%, transparent)`）：用于数据表容器和表头。
- **工具栏卡片阴影**（`0 1px 2px color-mix(in srgb, var(--foreground) 5%, transparent), 0 12px 24px -24px color-mix(in srgb, var(--foreground) 16%, transparent)`）：用于命令栏和搜索栏。
- **覆盖层阴影**（`0 18px 48px -24px color-mix(in srgb, var(--foreground) 30%, transparent)`）：用于弹窗、浮层和需要暂时盖过工作区的界面。

### Named Rules

**The Quiet Lift Rule.** 阴影必须轻，主要表达层级和状态，不承担装饰。

**The Border First Rule.** 常驻层级优先用 1px 边框和色面区分，只有交互或覆盖层才增加明显阴影。

## 5. Components

### Buttons

- **Shape:** 工具型按钮默认 4px，小尺寸保持紧凑；基础 shadcn 按钮仍保留 8px 作为系统上限。
- **Primary:** 图标暖橙背景、暖米文字，高度 32px，默认内边距 10px，工具栏按钮高度 36px。
- **Hover / Focus:** hover 只轻微加深或转为 muted 背景；focus 使用 ring 色和 3px 半透明焦点环；active 允许 1px 下压。
- **Secondary / Ghost / Tertiary:** outline、secondary、ghost 用背景和边框变化表达层级，不使用夸张阴影或渐变。

### Chips

- **Style:** 徽标高度 20px，999px 胶囊半径，12px 字号，强调徽标使用低透明图标暖橙底和主色文字。
- **State:** 选中、筛选、状态徽标必须用文字、图标或明确色彩语义辅助，不只依赖颜色。

### Cards / Containers

- **Corner Style:** 卡片默认 4px，表格、工具栏、设置项都沿用这个小半径。
- **Background:** 默认卡片接近近白，表格卡片会混入背景色，工具栏卡片会更贴近工作区底色。
- **Shadow Strategy:** 使用 Elevation 中的低阴影，hover 只提升交互卡片。
- **Border:** 使用 1px 伪元素描边，hover 通过边框混入主色表达可操作性。
- **Internal Padding:** 普通卡片 16px，面板 24px，工具栏由 56px 高度和 12px 水平内边距控制。

### Inputs / Fields

- **Style:** 输入框高 32px，8px 半径，透明背景，1px input 边框，水平内边距 10px。
- **Focus:** focus-visible 使用 ring 边框；编辑器聚焦时切换为 popover 背景，保持本地工具的清楚反馈。
- **Error / Disabled:** error 使用 failure 色边框和低透明红底；disabled 降低透明度并锁定指针。

### Navigation

- **Style:** 左侧桌面壳层导航展开约 256px，折叠约 48px；项目、任务、设置、质量和工具按组排列。
- **Active State:** 活跃项使用 3px 左侧选择轨和浅 accent 背景；hover 只出现轻量色面。
- **Motion:** 折叠、子项展开和选择轨使用 180 到 260ms 的 ease-out-quart 风格曲线。
- **Desktop Feel:** 导航项保持无圆角或极低圆角，避免网页标签页和移动端抽屉感。

### Tables

- **Structure:** 表头高度 36 到 42px，行高 36 到 39px，单元格水平内边距 12px。
- **Selection:** 选中行使用浅 accent 背景和 3px selection rail；键盘焦点增强选中底色。
- **Density:** 表格是主要工作面，优先保证列对齐、文本截断、拖拽指示和虚拟滚动稳定。

### Editor

- **Style:** 编辑器使用 13px 字号、1.7 行高、4px 半径、1px 边框和 popover 混合背景。
- **Whitespace:** 空格、全角空格、制表符高亮应细腻可见，服务校对和格式保留。
- **Readonly / Invalid:** 只读态降低前景和背景对比；无效态使用 failure 色，但不覆盖文本可读性。

## 6. Do's and Don'ts

### Do:
- **Do** 把根设计权威放在 `DESIGN.md`，代码 token 权威放在 `frontend/src/renderer/index.css`。
- **Do** 保持桌面客户端壳层：固定侧栏、标题栏安全区、工作区边界和紧凑工具栏。
- **Do** 使用 4px 卡片半径、32px 基础控件高度、36px 工具栏按钮高度和 12px 到 16px 的常规间距。
- **Do** 用图标暖橙表达主操作、选择轨、焦点和关键状态线索。
- **Do** 让页面首屏直接进入翻译、配置、校对、规则维护或文件处理任务。
- **Do** 在新增页面样式时遵守 px-first：尺寸字面量用 px，line-height 用无单位数值，letter-spacing 用 em。

### Don't:
- **Don't** 制造“网页感”：不要让整体视觉、布局节奏和交互反馈像浏览器网页或 Web SaaS 套壳。
- **Don't** 使用网页式大留白、滚动长页、营销式 hero、卡片堆叠的信息流或后台管理模板气质。
- **Don't** 把可爱气质做成大面积插画、强主题装饰、高饱和粉紫或浮夸动效。
- **Don't** 使用渐变文字、默认玻璃拟态、重复图标卡片网格或 hero-metric 模板。
- **Don't** 在页面私有 CSS 中重定义 `--ui-*` token，新增全局 token 必须回到 `frontend/src/renderer/index.css`。
- **Don't** 用超过 1px 的侧边彩条装饰卡片、列表项、提示或警告；选择轨只能用于导航、表格选中和明确交互状态。
