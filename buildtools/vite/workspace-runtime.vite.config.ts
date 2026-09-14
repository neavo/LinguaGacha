import { builtinModules } from "node:module";
import { defineConfig } from "vite";

import { project_path } from "./project-paths.js";

/** 自包含 Node bundle 将运行时读取授权收口到单个程序文件，开发与发布共用产物。 */
export default defineConfig({
  publicDir: false,
  build: {
    target: "node24",
    outDir: project_path("build", "workspace-runtime"),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: project_path("src/backend/agent/workspace/runtime/entry.ts"),
      formats: ["es"],
      fileName: () => "runtime.mjs",
    },
    rolldownOptions: {
      platform: "node",
      external: [...builtinModules, /^node:/u],
      output: {
        codeSplitting: false,
      },
    },
  },
});
