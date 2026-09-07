import { defineConfig } from "vite";

import { project_path } from "./project-paths.js";

/** 为 Deno 生成自包含单文件 ESM；库模式保留原生动态加载，避免浏览器包装器覆盖加载错误。 */
export default defineConfig({
  publicDir: false,
  build: {
    target: "esnext",
    outDir: project_path("resources", "deno"),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: project_path("src/backend/agent/workspace/runtime/entry.ts"),
      formats: ["es"],
      fileName: () => "deno-runtime.js",
    },
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
