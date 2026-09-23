import { mkdir, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { deploy_workspace_dependencies } from "./workspace-dependencies.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, "build/resources/workspace")); // 测试可在仓库外使用同一部署流程
await deploy_workspace_dependencies(root, output);

await build_package(
  "@lg/workspace",
  {
    bootstrap: "src/backend/agent/workspace/runtime/bootstrap.ts",
    "item-contexts": "src/backend/agent/workspace/runtime/item-contexts.ts",
    "page-updates": "src/backend/agent/workspace/page-updates.ts",
  },
  {
    "./bootstrap": "./bootstrap.mjs",
    "./item-contexts": "./item-contexts.mjs",
    "./page-updates": "./page-updates.mjs",
  },
  ["mupdf"],
);
await build_package(
  "@lg/text",
  { index: "src/shared/text/literal-matcher.ts" },
  { ".": "./index.mjs" },
);
// 库与计算线程共用包内 chunk；MuPDF JS/WASM 从同一预装依赖加载。
await build_package(
  "@lg/pdf",
  {
    index: "src/backend/file/formats/pdf/pdf-document.ts",
    worker: "src/backend/file/formats/pdf/pdf-worker-entry.ts",
  },
  { ".": "./index.mjs", "./worker": "./worker.mjs" },
  ["mupdf"],
);

/** 内部包清单与入口由构建拥有，源码仍按业务领域组织。 */
async function build_package(name, entries, exports, external = []) {
  const directory = path.join(output, "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name, private: true, type: "module", exports }, null, 2)}\n`,
  );
  await build({
    configFile: false,
    resolve: { conditions: ["node"], mainFields: ["module", "main"] },
    publicDir: false,
    build: {
      target: "node24",
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: Object.fromEntries(
          Object.entries(entries).map(([key, file]) => [key, path.join(root, file)]),
        ),
        formats: ["es"],
        fileName: (_format, entry) => `${entry}.mjs`,
      },
      rolldownOptions: {
        platform: "node",
        external: [...builtinModules, /^node:/u, ...external],
        output: {
          codeSplitting: Object.keys(entries).length > 1,
          chunkFileNames: "chunks/[name]-[hash].mjs",
        },
      },
    },
  });
}
