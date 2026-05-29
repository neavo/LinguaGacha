import { defineConfig } from "vitest/config";

import { frontend_resolve_alias } from "../vite/project-paths";

export default defineConfig({
  resolve: {
    alias: frontend_resolve_alias,
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "buildtools/**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/build/**", "**/dist/**", "**/dist-electron/**"],
    clearMocks: true,
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
            "react-dom",
            "react",
            "sonner",
          ],
        },
      },
    },
  },
});
