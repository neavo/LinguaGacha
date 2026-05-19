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
      rollupOptions: {
        input: {
          index: path.resolve(project_root, "src/index.ts"),
          // 产物名必须与 core-bundle-contract.ts 的 worker 入口契约一致
          "worker-entry": path.resolve(project_root, "src/core/engine/worker/worker-entry.ts"),
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: desktop_dist_dir,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          preload: path.resolve(project_root, "src/gui/preload/index.ts"),
        },
        output: {
          entryFileNames: "preload.mjs", // electron-vite 开发态固定生成 preload.mjs，发布构建沿用同名产物，避免 BrowserWindow 读取不存在的预加载脚本
        },
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
        "@gui/bridge-api": path.resolve(project_root, "src/gui/bridge/bridge-api.ts"),
        "@gui/bridge-types": path.resolve(project_root, "src/gui/bridge/bridge-types.ts"),
        "@core/api/core-api-endpoint": path.resolve(
          project_root,
          "src/core/api/core-api-endpoint.ts",
        ),
        "@gui/external-url-policy": path.resolve(
          project_root,
          "src/gui/shell/external-url-policy.ts",
        ),
        "@gui/ipc-contract": path.resolve(project_root, "src/gui/ipc/ipc-contract.ts"),
        "@gui/shell-contract": path.resolve(project_root, "src/gui/shell/shell-contract.ts"),
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
