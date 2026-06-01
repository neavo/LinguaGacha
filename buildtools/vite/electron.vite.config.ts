import { defineConfig } from "electron-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

import { frontend_resolve_alias, project_path } from "./project-paths";

const desktop_dist_dir = project_path("build", "dist-electron");

export default defineConfig({
  main: {
    build: {
      outDir: desktop_dist_dir,
      rolldownOptions: {
        input: {
          index: project_path("src/index.ts"),
          "backend-worker-entry": project_path("src/backend/worker/worker-entry.ts"),
          "planning-worker-entry": project_path(
            "src/backend/engine/planning/planning-worker-entry.ts",
          ),
          "work-unit-worker-entry": project_path(
            "src/backend/engine/work-unit/work-unit-worker-entry.ts",
          ),
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: desktop_dist_dir,
      emptyOutDir: false,
      rolldownOptions: {
        input: {
          preload: project_path("src/gui/preload/index.ts"),
        },
        output: {
          entryFileNames: "preload.mjs",
        },
      },
    },
  },
  renderer: {
    root: project_path("src/frontend"),
    publicDir: project_path("public"),
    server: {
      host: "127.0.0.1",
    },
    resolve: {
      alias: frontend_resolve_alias,
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: project_path("build", "dist"),
      rolldownOptions: {
        input: {
          index: project_path("src/frontend/index.html"),
        },
      },
    },
  },
});
