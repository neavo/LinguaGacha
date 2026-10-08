import { defineConfig } from "vitest/config";

import { frontend_resolve_alias } from "../vite/project-paths.js";

export default defineConfig({
  resolve: {
    alias: frontend_resolve_alias,
  },
  test: {
    allowOnly: false,
    exclude: ["**/node_modules/**", "**/build/**", "**/dist/**", "**/dist-electron/**"],
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}", "buildtools/**/*.test.mjs"],
          exclude: ["src/frontend/**/*.test.{ts,tsx}", "src/gui/preload/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "renderer",
          environment: "jsdom",
          pool: "vmForks", // 逐文件 VM 隔离并复用依赖加载，降低 DOM 测试的启动成本。
          setupFiles: ["./src/test/renderer-setup.ts"],
          include: ["src/frontend/**/*.test.{ts,tsx}", "src/gui/preload/**/*.test.{ts,tsx}"],
          deps: {
            optimizer: {
              client: {
                enabled: true,
                // CodeMirror 扩展与状态必须共用模块实例，React 渲染也共用同一入口。
                include: [
                  "@codemirror/commands",
                  "@codemirror/lang-javascript",
                  "@codemirror/lang-json",
                  "@codemirror/lang-markdown",
                  "@codemirror/language",
                  "@codemirror/state",
                  "@codemirror/view",
                  "@base-ui/react",
                  "@streamdown/mermaid", // 图表依赖沿 Vite 的浏览器解析规则加载。
                  "react-dom",
                  "react",
                ],
              },
            },
          },
        },
      },
    ],
  },
});
