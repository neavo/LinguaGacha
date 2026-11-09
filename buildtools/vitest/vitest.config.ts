import { defineConfig } from "vitest/config";

import { frontend_resolve_alias } from "../vite/project-paths.js";

// 这些测试消费完整部署资源，统一构建一次后仍按文件并发执行。
const INTEGRATION_TESTS = [
  "src/backend/agent/npm/index.test.ts",
  "src/backend/agent/workspace/runtime/bootstrap.test.ts",
  "src/backend/file/pdf/pdf-worker.test.ts",
  "src/backend/file/shared/javascript.test.ts",
  "src/backend/file/rpgmaker-rgss/ruby.test.ts",
  "src/backend/file/shared/game/prepare-worker.test.ts",
  "src/native/pdf-host.test.ts",
];

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
          globalSetup: ["./buildtools/vitest/global-setup.mjs"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: [
            "src/frontend/**/*.test.{ts,tsx}",
            "src/gui/preload/**/*.test.{ts,tsx}",
            ...INTEGRATION_TESTS,
          ],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          globalSetup: ["./buildtools/vitest/global-setup.mjs"],
          include: INTEGRATION_TESTS,
          sequence: { groupOrder: 1 }, // 宿主进程和环境初始化独占一个阶段，避免与普通测试争抢资源。
          testTimeout: 30_000, // 晚于工作区执行的 15 秒取消信号，留出进程和租约收尾时间。
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
