import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const project_root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(project_root, "src/renderer"),
      "@base": path.resolve(project_root, "src/base"),
      "@core/api/core-api-endpoint": path.resolve(
        project_root,
        "src/core/api/core-api-endpoint.ts",
      ),
      "@gui/bridge-api": path.resolve(project_root, "src/gui/bridge/bridge-api.ts"),
      "@gui/bridge-types": path.resolve(project_root, "src/gui/bridge/bridge-types.ts"),
      "@gui/external-url-policy": path.resolve(
        project_root,
        "src/gui/shell/external-url-policy.ts",
      ),
      "@gui/ipc-contract": path.resolve(project_root, "src/gui/ipc/ipc-contract.ts"),
      "@gui/shell-contract": path.resolve(project_root, "src/gui/shell/shell-contract.ts"),
      "@shared": path.resolve(project_root, "src/shared"),
    },
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
