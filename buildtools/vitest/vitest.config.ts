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
          environment: "happy-dom",
          pool: "threads",
          setupFiles: ["./src/test/renderer-setup.ts"],
          include: ["src/frontend/**/*.test.{ts,tsx}", "src/gui/preload/**/*.test.{ts,tsx}"],
          deps: {
            optimizer: {
              client: {
                enabled: true,
                include: [
                  "@codemirror/commands",
                  "@codemirror/lang-javascript",
                  "@codemirror/lang-json",
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
                  "@base-ui/react",
                  "react-dom",
                  "react",
                  "sonner",
                ],
              },
            },
          },
        },
      },
    ],
  },
});
