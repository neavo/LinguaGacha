import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root_dir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root_dir, "src/renderer"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**"],
    clearMocks: true,
    // Why: 渲染层测试长期跑在浏览器模拟环境里，提前打包重 UI 依赖能明显减少重复模块加载成本。
    deps: {
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
