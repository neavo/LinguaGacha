# frontend-vite 子工程规格

## 一句话总览
`frontend-vite` 是 LinguaGacha 的 Electron + React 子工程，采用 `main / preload / shared / renderer` 四段结构：主进程负责桌面宿主，预加载负责安全桥接，共享层负责跨端契约，渲染层负责界面、导航、状态与样式。

## 顶层目录与入口
| 路径 | 职责 |
| --- | --- |
| `package.json` | 子工程命令入口，集中声明 `dev`、`build`、`lint`、`renderer:audit` 与 `preview` |
| `components.json` | shadcn CLI 配置权威来源，定义 `style`、`base`、全局 CSS 和 `@/shadcn` / `@/widgets` 等别名 |
| `electron.vite.config.ts` | Electron / Vite 构建入口与 renderer 别名配置 |
| `electron-builder.json5` | Electron 打包配置 |
| `core-api-port-candidates.json` | Core API 候选端口清单 |
| `scripts/` | 子工程级脚本与审查工具，例如 `check-renderer-design-system.mjs` |
| `src/main/` | Electron 主进程；只处理窗口创建、原生对话框、标题栏策略与 IPC 落地 |
| `src/preload/` | `window.desktopApp` 桥接层；只暴露渲染层必须消费的桌面能力 |
| `src/shared/` | 主进程、预加载与渲染层共享的桌面契约、壳层常量和 Core API 地址解析规则 |
| `src/renderer/` | React 渲染层；具体分层、样式边界、组件落位与审查规则见 [`src/renderer/SPEC.md`](./src/renderer/SPEC.md) |
| `public/` | 以原始路径暴露给 HTML / Electron 的静态资源，例如 `icon.png` 与字体文件 |

## Electron / Shared 侧边界
- `src/main/` 不承载页面状态、业务请求流程或渲染层工具。
- `src/preload/` 只组织 `contextBridge` 暴露对象，不维护页面状态与 UI 逻辑。
- IPC channel、桌面壳层信息、桥接类型、标题栏高度和 Core API 地址解析统一收敛在 `src/shared/`。
- Core API 候选地址解析由 [`src/shared/core-api-base-url.ts`](./src/shared/core-api-base-url.ts) 负责；`src/preload/index.ts` 只桥接候选列表，渲染层再负责探活、缓存和选择权威 base URL。

## 渲染层入口
- 渲染层所有稳定规则统一收敛在 [`src/renderer/SPEC.md`](./src/renderer/SPEC.md)。
- 修改 `src/renderer/` 下的目录落位、样式分层、组件归属、命名空间、审查脚本或导航入口时，先读 `src/renderer/SPEC.md`，不要再找旧的 `ui/` 或 `widgets/` 局部 SPEC。
- `src/renderer/shadcn/` 是 shadcn CLI 管理的基础组件目录；`components.json` 中 `aliases.ui` 的值固定指向 `@/shadcn`。

## 命令与审查
| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron + renderer 开发环境 |
| `npm run build` | 类型检查、构建 renderer 与 Electron 产物并执行打包 |
| `npm run lint` | ESLint 检查 |
| `npm run renderer:audit` | 渲染层设计系统与样式边界硬规则审查 |
| `npm run preview` | Electron 预览构建产物 |

## 改动入口建议
1. 调整构建入口、输出目录、Vite alias 或 renderer root 时，优先修改 `electron.vite.config.ts`，再同步检查 `package.json` 与 `components.json`。
2. 调整桌面桥接接口时，先改 `src/shared/` 契约，再同步 `src/preload/index.ts` 与渲染层消费代码。
3. 调整 Electron 窗口、标题栏或原生能力时，优先修改 `src/main/` 与 `src/shared/`，不要把桌面宿主逻辑散落到渲染层。
4. 调整渲染层分层、组件落位、样式边界、导航与页面入口时，直接进入 [`src/renderer/SPEC.md`](./src/renderer/SPEC.md) 对照实施。
