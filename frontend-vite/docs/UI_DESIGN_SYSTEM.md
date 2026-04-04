# frontend-vite UI 设计系统

## 一句话目标
把视觉决定权收回到基础组件与全局 token 层，页面层只负责布局、信息密度和语义状态，避免“同样是卡片/按钮却长得不一样”。

## 全局 token
所有 UI 语义 token 统一定义在 [`src/renderer/index.css`](../src/renderer/index.css)。

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

## 基础组件职责
### Card
[`Card`](../src/renderer/components/ui/card.tsx) 负责：

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

### Button
[`Button`](../src/renderer/components/ui/button.tsx) 负责：

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

### Table
[`Table`](../src/renderer/components/ui/table.tsx) 负责：

- 表头高度
- 行高
- 分隔线强度
- hover / selected 背景

页面层只保留：

- 列宽
- 对齐方式
- sticky / scroll 等布局能力

### ActionBar / Toolbar
[`ActionBar`](../src/renderer/components/ui/action-bar.tsx) 是页面应优先复用的高层动作条组件。  
[`Toolbar`](../src/renderer/components/ui/toolbar.tsx) 是低层布局原语，仅用于 `ActionBar` 或极少数特殊容器。

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

## 页面层禁区
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

## 审查命令
运行下面的命令检查是否有页面层视觉越权：

```bash
npm run ui:audit
```

当前审查会检查：

- `--ui-*` 是否只在全局 token 文件中定义
- 页面命名空间是否直接改卡片阴影 / 边界 / 圆角
- 工作台表格是否重新定义基础表格分隔线与 hover 视觉
