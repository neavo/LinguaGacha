import { defineConfig } from "electron-vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const project_root = path.resolve(__dirname, "..", "..");
const build_root = path.resolve(project_root, "build");
const desktop_dist_dir = path.resolve(build_root, "dist-electron");

const config = {
  main: {
    build: {
      outDir: desktop_dist_dir,
      rollupOptions: {
        input: {
          index: path.resolve(project_root, "src/index.ts"),
          "planning-worker-entry": path.resolve(project_root, "src/core/engine/planning/planning-worker-entry.ts"),
          "work-unit-worker-entry": path.resolve(project_root, "src/core/engine/work-unit/work-unit-worker-entry.ts"),
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
          entryFileNames: "preload.mjs",
        },
      },
    },
  },
  renderer: {
    root: path.resolve(project_root, "src/renderer"),
    publicDir: path.resolve(project_root, "public"),
    server: {
      host: "127.0.0.1",
    },
    resolve: {
      alias: {
        "@": path.resolve(project_root, "src/renderer"),
        "@base": path.resolve(project_root, "src/base"),
        "@core/api/core-api-endpoint": path.resolve(project_root, "src/core/api/core-api-endpoint.ts"),
        "@gui/bridge-api": path.resolve(project_root, "src/gui/bridge/bridge-api.ts"),
        "@gui/bridge-types": path.resolve(project_root, "src/gui/bridge/bridge-types.ts"),
        "@gui/external-url-policy": path.resolve(project_root, "src/gui/shell/external-url-policy.ts"),
        "@gui/ipc-contract": path.resolve(project_root, "src/gui/ipc/ipc-contract.ts"),
        "@gui/shell-contract": path.resolve(project_root, "src/gui/shell/shell-contract.ts"),
        "@shared": path.resolve(project_root, "src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
    worker: {
      format: "es",
    },
    build: {
      outDir: path.resolve(build_root, "dist"),
    },
  },
};

export default defineConfig(config as import("electron-vite").UserConfig);
