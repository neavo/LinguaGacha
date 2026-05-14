import { defineConfig } from "electron-vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const project_root = path.resolve(__dirname, "..", "..");
const build_root = path.resolve(project_root, "build");
const desktop_dist_dir = path.resolve(build_root, "dist-electron");

// Electron 三端构建配置在这里集中维护，确保 main/preload/renderer 输出目录互不覆盖
const config = {
  main: {
    build: {
      outDir: desktop_dist_dir,
    },
    rollupOptions: {
      input: {
        index: path.resolve(project_root, "src/main/index.ts"),
        // task worker 必须作为独立入口产物输出，worker_threads 运行时不能从 main bundle 内动态取源码
        "task-worker-entry": path.resolve(
          project_root,
          "src/main/task-worker/task-worker-entry.ts",
        ),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
  preload: {
    build: {
      outDir: desktop_dist_dir,
      emptyOutDir: false,
    },
    rollupOptions: {
      input: {
        preload: path.resolve(project_root, "src/preload/index.ts"),
      },
      output: {
        entryFileNames: "index.mjs", // BrowserWindow 的 preload 契约固定读取 build/dist-electron/index.mjs，产物名不能随入口名漂移
      },
    },
  },
  renderer: {
    root: path.resolve(project_root, "src/renderer"),
    publicDir: path.resolve(project_root, "public"),
    server: {
      host: "127.0.0.1", // 开发态 renderer 统一监听 IPv4 回环地址，避免主进程与 dev server 对本机地址的解析结果不一致；这里定义的是唯一权威监听地址，不再依赖 localhost 或额外兼容回退
    },
    resolve: {
      alias: {
        "@": path.resolve(project_root, "src/renderer"),
        "@base": path.resolve(project_root, "src/base"),
        "@desktop": path.resolve(project_root, "src/desktop"),
        "@shared": path.resolve(project_root, "src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
    worker: {
      format: "es", // 渲染层 Worker 都以 module worker 创建，ES 输出允许生产构建正常分包
    },
    build: {
      outDir: path.resolve(build_root, "dist"),
    },
  },
};

// electron-vite 5 的运行时支持 `build.outDir`，但当前类型声明尚未完整覆盖这层配置
export default defineConfig(config as import("electron-vite").UserConfig);
