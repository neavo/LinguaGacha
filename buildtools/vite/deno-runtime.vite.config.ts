import { defineConfig } from "vite";

import { project_path } from "./project-paths.js";

/** Deno runtime 必须是单一自包含 ESM，运行期没有源码、npm 或相邻 chunk 读取权限。 */
export default defineConfig({
  publicDir: false,
  build: {
    target: "esnext",
    outDir: project_path("resources", "deno"),
    emptyOutDir: false,
    minify: false,
    rolldownOptions: {
      input: project_path("src/backend/agent/workspace/runtime/entry.ts"),
      output: {
        entryFileNames: "deno-runtime.js",
        codeSplitting: false,
        format: "es",
      },
    },
  },
});
