import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const project_root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(project_root, "src/renderer"),
      "@base": path.resolve(project_root, "src/base"),
      "@native/bridge-api": path.resolve(project_root, "src/native/bridge-api.ts"),
      "@native/bridge-types": path.resolve(project_root, "src/native/bridge-types.ts"),
      "@native/core-api-endpoint": path.resolve(project_root, "src/native/core-api-endpoint.ts"),
      "@native/external-url-policy": path.resolve(project_root, "src/native/external-url-policy.ts"),
      "@native/ipc-contract": path.resolve(project_root, "src/native/ipc-contract.ts"),
      "@native/shell-contract": path.resolve(project_root, "src/native/shell-contract.ts"),
      "@shared": path.resolve(project_root, "src/shared"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
