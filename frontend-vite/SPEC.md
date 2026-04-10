# frontend-vite 架构与开发规范

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

## Electron 侧边界
- 主进程入口固定为 `src/main/index.ts`，不要把预加载、页面状态或渲染层工具塞进来。
- 预加载入口固定为 `src/preload/index.ts`，只允许组织 `contextBridge` 暴露对象，不允许在这里写页面状态或业务请求流程。
- IPC channel、桌面壳层信息、标题栏高度和桥接类型统一收敛在 `src/shared/`，按 `ipc-channels.ts`、`desktop-shell.ts` 与 `desktop-types.ts` 拆分，避免主进程、预加载和渲染层类型声明各自维护一套常量。
- Core API 候选地址解析直接内聚在 `src/preload/index.ts`，因为它只服务预加载桥接，没必要再额外拆一个单一消费方文件。

## 渲染层组织规则
### 入口与命名
- 渲染层根目录固定为 `src/renderer/`，`index.html` 与 `index.tsx` 都放在该目录，保持 electron-vite 默认入口约定。
- 应用根组件固定在 `src/renderer/app/index.tsx`，负责组装渲染层 Provider、主题/导航协调逻辑与应用壳层。
- 页面注册表固定在 `src/renderer/app/navigation/screen-registry.ts`，并与 `schema.ts` 同属导航域维护。
- 目录名统一使用 `kebab-case`，例如 `app-settings-page`、`command-bar`。
- 除约定入口文件外，渲染层源码文件统一使用 `kebab-case`，包括组件文件、hook 文件、context 文件与普通模块文件。
- 页面目录固定以 `page.tsx` 作为入口；`mock.ts`、`types.ts`、`<page-name>.css`、`use-*.ts` 与其他同目录辅助模块按需出现，继续保持语义化命名，不要为了凑整额外造别名。
- 约定后缀文件保留现有后缀语义，例如 `page-scaffold.mock.ts`、`vite-env.d.ts`；这类文件重点是保持后缀可读，而不是强行改成单段命名。

### 分层模型
继续沿用 `app / pages / widgets / ui / i18n / lib` 分层，其中：

| 位置 | 应该放什么 | 不该放什么 |
| --- | --- | --- |
| `src/renderer/app/` | 应用级壳层、导航、主题源、跨页面状态、全局服务与渲染层桌面 API 适配 | 页面局部视觉细节、单页临时状态、一次性业务组件 |
| `src/renderer/ui/` | 设计系统原子与薄封装组件，例如 `Button`、`Card`、`Table`、`Empty`；详细约束见 [`src/renderer/ui/SPEC.md`](./src/renderer/ui/SPEC.md) | 页面业务文案、具体页面状态、接口请求、项目/工作台等业务语义 |
| `src/renderer/widgets/` | 跨页面复用的业务部件，由多个 `ui` 组件与少量业务 props 组合而成，例如 `CommandBar`、表格外壳、导航侧栏；详细约束见 [`src/renderer/widgets/SPEC.md`](./src/renderer/widgets/SPEC.md) | 只服务单一页面的临时拆分组件；重新定义基础视觉规范的组件 |
| `src/renderer/pages/<page-name>/components/` | 只被当前页面使用的局部业务组件，允许依赖该页面的类型、文案键、状态与样式命名空间 | 被多个页面共享的通用部件；可以沉到 `widgets` 或 `ui` 的通用逻辑 |
| `src/renderer/pages/<page-name>/page.tsx` | 页面装配入口，负责组织页面状态、调用页面级 hooks、拼接本页组件树并导入页面 CSS | 过多视觉细节、可复用组件实现、跨页面共享逻辑 |

`ui/` 与 `widgets/` 的落位判断、依赖方向、组件演化与验证规则分别定义在：

- [`src/renderer/ui/SPEC.md`](./src/renderer/ui/SPEC.md)
- [`src/renderer/widgets/SPEC.md`](./src/renderer/widgets/SPEC.md)

### 样式与资源边界
- `src/renderer/index.css` 只负责主题 token、Tailwind / shadcn 全局覆写和跨页面复用规则。
- `src/renderer/app/shell/app-shell.css` 只负责应用壳层、侧栏、工作区和占位骨架等共享布局样式。
- 页面私有样式必须放在页面目录下，由页面入口 `page.tsx` 统一导入；不要让子组件各自导入页面级 CSS。
- 带页面语义的选择器，如 `project-home*`、`workbench-page*`，只能留在对应页面目录的 CSS 文件中。
- `public/` 只放原始静态资源；本地化文案、mock 数据和页面配置属于源码资源，必须留在 `src/renderer/` 内参与构建。

## 渲染层说明索引
`frontend-vite/SPEC.md` 负责子工程级总览、目录职责与改动入口。`src/renderer/ui/` 与 `src/renderer/widgets/` 的规范入口如下：

- [`src/renderer/ui/SPEC.md`](./src/renderer/ui/SPEC.md)：设计系统、基础组件职责、全局 token、第三方基础组件定制路径、`ui:audit` 门闩说明。
- [`src/renderer/widgets/SPEC.md`](./src/renderer/widgets/SPEC.md)：业务部件落位判断、依赖方向、组件演化规则、复用部件示例与验证要求。

约定：

- 涉及 `ui/` 或 [`src/renderer/index.css`](./src/renderer/index.css) 的系统级改动时，先读 `src/renderer/ui/SPEC.md`。
- 涉及 `widgets/` 提升、下沉、重命名或跨页面复用边界时，先读 `src/renderer/widgets/SPEC.md`。
- `frontend-vite/SPEC.md` 提供子工程级地图；`src/renderer/ui/SPEC.md` 与 `src/renderer/widgets/SPEC.md` 分别描述各自目录的稳定规则。

## 改动入口建议
1. 调整 Electron 入口或产物路径时，优先修改 `electron.vite.config.ts`，再同步检查 `package.json` 与 `electron-builder.json5`。
2. 调整桌面桥接接口时，先改 `src/shared/` 下对应的契约模块，再同步 `src/preload/index.ts` 和渲染层消费代码；只在预加载层生效的辅助逻辑则直接留在 `src/preload/`。
3. 调整 Core API 候选地址或桌面端 HTTP 访问策略时，串起来检查 `core-api-port-candidates.json`、`src/preload/index.ts` 与 `src/renderer/app/desktop-api.ts`。
4. 调整主题源、全局通知、跨页面状态、第三方运行时适配或其他应用级服务时，优先改 `src/renderer/app/`，不要把这类规则散落到 `ui/` 或页面目录。
5. 调整导航或页面注册时，优先改 `src/renderer/app/navigation/`，避免把页面注册逻辑散落到壳层组件内。
6. 新增页面时，以 `pages/<page-name>/page.tsx` 为入口，再按需要并置 `<page-name>.css`、`mock.ts`、`types.ts` 或页面私有 hook / 辅助模块，并从导航注册表接入。
7. 调整 `ui/` 或 `widgets/` 的规范、职责与分层时，除了改代码，还要同步各自目录下的 `SPEC.md`，再检查本文件的索引是否仍然成立。
