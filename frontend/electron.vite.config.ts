import { defineConfig } from "electron-vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// Electron 三端构建配置在这里集中维护，确保 main/preload/renderer 输出目录互不覆盖。
const config = {
  main: {
    build: {
      outDir: "dist-electron",
    },
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "src/main/index.ts"),
        // task worker 必须作为独立入口产物输出，worker_threads 运行时不能从 main bundle 内动态取源码。
        "task-worker-entry": path.resolve(__dirname, "src/main/task-worker/task-worker-entry.ts"),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
  preload: {
    build: {
      outDir: "dist-electron",
      emptyOutDir: false,
    },
    rollupOptions: {
      input: {
        preload: path.resolve(__dirname, "src/preload/index.ts"),
      },
      output: {
        // BrowserWindow 的 preload 契约固定读取 dist-electron/index.mjs，产物名不能随入口名漂移。
        entryFileNames: "index.mjs",
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    publicDir: path.resolve(__dirname, "public"),
    server: {
      // 开发态 renderer 统一监听 IPv4 回环地址，避免主进程与 dev server 对本机地址的解析结果不一致。
      // 这里定义的是唯一权威监听地址，不再依赖 localhost 或额外兼容回退。
      host: "127.0.0.1",
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
        "@shared": path.resolve(__dirname, "src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
    worker: {
      // 渲染层 Worker 都以 module worker 创建，ES 输出允许生产构建正常分包。
      format: "es",
    },
    build: {
      outDir: path.resolve(__dirname, "dist"),
    },
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
};

// electron-vite 5 的运行时支持 `build.outDir`，但当前类型声明尚未完整覆盖这层配置。
export default defineConfig(config as import("electron-vite").UserConfig);
