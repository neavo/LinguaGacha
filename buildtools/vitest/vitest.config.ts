import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const project_root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(project_root, "src/renderer"),
      "@base": path.resolve(project_root, "src/base"),
      "@desktop": path.resolve(project_root, "src/desktop"),
      "@shared": path.resolve(project_root, "src/shared"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/build/**", "**/dist/**", "**/dist-electron/**"],
    clearMocks: true,
    deps: { // 原因：渲染层测试长期跑在浏览器模拟环境里，提前打包重 UI 依赖能明显减少重复模块加载成本
      optimizer: {
        client: {
          enabled: true,
          include: [
            "@codemirror/commands",
            "@codemirror/lang-markdown",
            "@codemirror/language",
            "@codemirror/state",
            "@codemirror/view",
            "@dnd-kit/core",
            "@dnd-kit/sortable",
            "@dnd-kit/utilities",
            "@tanstack/react-virtual",
            "lucide-react",
            "next-themes",
            "radix-ui",
            "react",
            "react-dom",
            "sonner",
          ],
        },
      },
    },
  },
});
