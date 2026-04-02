# 指导文件：Electron + React 原生级 UI 项目启动指南

## 🛠 第一阶段：技术栈初始化 (Scaffolding)

**AI 任务目标：** 搭建一个高性能、目录清晰的 Electron + Vite + React 现代化开发环境。

**要求与逻辑：**
1.  **使用 `electron-vite` 启动项目**：这是目前最成熟的脚手架，它能自动处理主进程 (Main) 和渲染进程 (Renderer) 的 HMR（热更新）。
2.  **集成 Tailwind CSS**：它是 shadcn/ui 的基石，也是我们后续精确控制桌面级样式的工具。
3.  **配置 shadcn/ui**：安装基础组件库，但注意不要直接使用默认配置，后续需要微调。

**AI 执行指令：**
> "请使用 `electron-vite` 模板创建一个 React + TypeScript 项目。安装 Tailwind CSS 并初始化 shadcn/ui。确保项目结构清晰，将主进程代码放在 `src/main`，渲染进程（React 代码）放在 `src/renderer`。"

---

## 🛠 第二阶段：打破“浏览器外壳” (Native Window Strategy)

**AI 任务目标：** 让窗口看起来像一个真正的独立软件，而不是 Chrome 标签页。

**设计逻辑：**
1.  **无边框窗口 (Frameless Window)**：隐藏系统默认标题栏。
2.  **保留系统交互**：在 Windows 上通过 `titleBarOverlay` 保留原生控制按钮（最小化/全屏/关闭），在 macOS 上保留“红绿灯”。
3.  **安全桥接 (Context Isolation)**：通过 `preload.js` 暴露必要的数据通路，严禁在渲染进程直接调用 Node.js API。

**给 AI 的方法说明：**
> "在主进程 `main/index.ts` 中，配置 `BrowserWindow`。设置 `frame: false`（或 `titleBarStyle: 'hidden'`），并配置 `titleBarOverlay` 以适配 Windows 原生按钮。请确保配置了 `preload` 脚本，遵循 Electron 安全最佳实践。"

---

## 🛠 第三阶段：注入桌面级 CSS 基因 (CSS Architecture)

**AI 任务目标：** 从底层彻底封死 Web 特有的交互行为。

**核心逻辑：**
1.  **禁用“网页感”行为**：桌面应用不应该能通过鼠标拖拽选中 UI 文字，也不应该能拖拽图片。
2.  **设置“拖拽区”**：既然隐藏了标题栏，我们需要在应用顶部手动指定一个区域，让用户按住它就能移动窗口。
3.  **定义“原生色彩空间”**：使用类似 PyQt 截图中的浅灰（Background）与纯白（Card/Panel）的对比逻辑。

**给 AI 的方法说明：**
> "在全局 CSS 中注入以下逻辑：
> - 针对 `body` 设置 `user-select: none` 和 `overflow: hidden`。
> - 设置全局背景色为浅灰色（如 `bg-slate-50`）。
> - 创建一个自定义的 `.titlebar` 类，使用 `-webkit-app-region: drag` 实现窗口拖拽。
> - 对所有 `button` 和 `input` 显式声明 `-webkit-app-region: no-drag`，否则它们将无法点击。"

---

## 🛠 第四阶段：重构 shadcn 组件规范 (Component System Customization)

**AI 任务目标：** 修改 shadcn 的默认样式，使其从“Web SaaS 风格”转向“桌面软件风格”。

**重构逻辑：**
1.  **降低视觉高度 (Elevation)**：网页喜欢用阴影（Shadow）表达层级，但现代桌面软件（如 Windows Fluent Design 或 macOS）更喜欢用 **1px 细边框** 和 **明度差**。
2.  **提高 UI 密度**：网页组件通常偏大。桌面应用需要更紧凑的间距、更小的字体、更低的高度（例如 Button 从 h-10 降到 h-8）。
3.  **布局隔离**：强制使用“固定视口”布局。

**给 AI 的具体要求：**
> "当我要求你安装 shadcn 组件时，请执行以下微调：
> - **Card 组件**：移除 `shadow-sm`，确保背景为纯白，边框颜色极浅。
> - **Button 组件**：默认 Size 调小，移除过于明显的 Hover 位移动画。
> - **Dialog 组件**：确保遮罩层 (Overlay) 不要太黑，保持轻量感。
> - **全局字体**：强制使用系统原生字体族。"

---

## 🛠 第五阶段：构建主应用壳层布局 (The Shell Layout)

**AI 任务目标：** 编写 App 的核心骨架。

**设计布局方案：**
-   **TopBar**：高度约 32px-40px，左侧放置 Logo/标题，右侧留空给系统控制按钮。
-   **Main Shell**：`display: flex; height: calc(100vh - TopBarHeight)`。
-   **Sidebar**：左侧固定宽度，背景色与 TopBar 保持一致或略深，与右侧主区域有明显的 1px 分隔线。
-   **Content Area**：内部使用 `overflow-y: auto`，这是应用内唯一允许出现滚动条的地方。

**给 AI 的方法说明：**
> "请在 `App.tsx` 中构建主布局骨架。要求使用 Flexbox 布局，确保整个应用视口被锁定（100vh/100vw）。将应用划分为顶部拖拽区、左侧导航面板和右侧内容展示区。所有的内容滚动必须限制在右侧展示区内部，且滚动条需进行美化，使其呈现为纤细的桌面风格。"