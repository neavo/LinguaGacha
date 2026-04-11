# 渲染层 widgets 业务部件规范

## 一句话总览
`src/renderer/widgets/` 收纳跨页面复用的业务部件：它们由多个 `ui/` 组件与少量业务 props 组合而成，负责承载稳定复用的业务界面骨架，但不重新定义设计系统基线。

## 职责边界
| 应该放什么 | 不该放什么 |
| --- | --- |
| 跨页面复用的业务部件，例如命令条、表格外壳、布尔分段开关、设置行、应用标题栏与侧栏 | 只服务单一页面的临时拆分组件 |
| 建立在 `ui/` 组件之上的稳定组合与业务语义 slot | 设计系统原子、通用无障碍骨架、第三方基础组件适配层 |
| 少量跨页面共享的业务 props 与布局逻辑 | 需要页面私有状态、页面文案、页面命名空间才能成立的实现 |

- `widgets/` 可以依赖 `ui/`、`lib/`、`i18n/`，但不要导入具体页面目录下的实现。
- 页面可以消费 `widgets/`，但 `widgets/` 不应该反向依赖 `pages/`。
- 如果变化已经升级成应用级生命周期、跨页面状态汇聚或全局服务，请继续上提到 `src/renderer/app/`。

## 落位判断
1. 如果变化主要沉淀统一视觉、交互基线或通用语义骨架，放 `ui/`。
2. 如果离开当前页面后仍成立，并且已经或即将被多个页面消费，放 `widgets/`。
3. 如果它依赖当前页面的状态、文案、样式命名空间或动作，只留在页面目录。
4. 如果还拿不准，先留在最靠近使用点的位置；只有复用边界稳定后，再上提。

## 结构与命名
- 目录名与源码文件统一使用 `kebab-case`。
- 新 widget 一旦需要私有 CSS、辅助模块或未来扩展空间，优先使用“目录 + 同名入口文件”的结构。
- widget 私有样式必须使用 widget 自己的命名空间，不要写带页面语义的选择器。
- 对所有消费者都必需的 widget 样式，优先由 widget 自己导入，避免每个页面重复记忆样式入口。
- 页面如果还要额外补样式，只能补自己的布局与局部语义，不要重新接管 widget 的基础壳层。

## 当前样式入口现状
| 场景 | 当前事实 | 修改时要注意 |
| --- | --- | --- |
| 常规跨页 widget | `CommandBar`、`BooleanSegmentedToggle` 与 `AppTable` 已由组件入口自己导入私有 CSS | 新增同类 widget 时优先沿用这个模式 |
| `SettingCardRow` | [`setting-card-row.css`](./setting-card-row/setting-card-row.css) 当前仍由页面入口统一引入 | 改动后同步检查 `basic-settings-page`、`expert-settings-page`、`app-settings-page` 与 `model-page` |
| `AppSidebar` / `AppTitlebar` | 样式当前收敛在 [`../app/shell/app-shell.css`](../app/shell/app-shell.css) | 它们与应用壳层强耦合，修改时把 `widgets/` 与 `app/` 当作联动改动 |

## 当前部件示例
| 部件 | 路径 | 定位 |
| --- | --- | --- |
| `CommandBar` | [`./command-bar/command-bar.tsx`](./command-bar/command-bar.tsx) | 跨页面复用的业务动作条壳层与按钮编排 |
| `AppTable` | [`./app-table/app-table.tsx`](./app-table/app-table.tsx) | 跨页面复用的表格交互骨架，统一排序、选择、拖拽、虚拟滚动与占位行 |
| `SearchBar` | [`./search-bar/search-bar.tsx`](./search-bar/search-bar.tsx) | 规则页复用的顶部搜索与筛选条，统一关键字、范围与正则交互基线 |
| `BooleanSegmentedToggle` | [`./boolean-segmented-toggle/boolean-segmented-toggle.tsx`](./boolean-segmented-toggle/boolean-segmented-toggle.tsx) | 业务语义明确的布尔分段开关 |
| `SettingCardRow` | [`./setting-card-row/setting-card-row.tsx`](./setting-card-row/setting-card-row.tsx) | 设置页共用的“说明 + 操作”行 |
| `AppSidebar` / `AppTitlebar` | [`./app-sidebar/app-sidebar.tsx`](./app-sidebar/app-sidebar.tsx) / [`./app-titlebar/app-titlebar.tsx`](./app-titlebar/app-titlebar.tsx) | 应用壳层可复用部件 |

## 演化规则
- 新组件默认先放最靠近使用点的位置，只有在复用边界已经清晰后再上提。
- 页面组件出现第二个页面消费者时，先评估是否提到 `widgets/`，不要继续跨页面引用页面目录。
- `widgets/` 如果只剩单一页面消费者，且强依赖该页面状态，可以下沉回页面目录，避免形成伪共享层。
- `widgets/` 不负责重新定义基础视觉基线；如果 widget 需要改 `Card`、`Button`、`Table` 这类底层契约，应先回到 `ui/` 或全局 token 处理。
- 对 `widgets/`、全局样式和应用级服务层的修改默认都要视为“影响多个消费方”，改动前后都要检查现有消费者是否仍满足统一契约。

## 验证与维护
- 修改 widget 后，必须至少回归所有现有消费者，不能只验证当前页面。
- 如果 widget 改动牵涉基础视觉、全局 token 或 `index.css` 皮肤，同时运行 `npm run ui:audit`。
- 对亮暗主题都有显著视觉影响的 widget，至少做一轮手工主题回归，确认间距、字号、分隔线和强调样式没有漂移。
