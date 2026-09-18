import { mkdir, readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { deploy_workspace_dependencies } from "./workspace-dependencies.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, "build/resources/workspace")); // 测试可在仓库外使用同一部署流程
await deploy_workspace_dependencies(root, output);
await build_pdf_print_assets();

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

/** 构建一次离线打印样式；字体来自 UI 与 KaTeX 的权威资源，不维护手工副本。 */
async function build_pdf_print_assets() {
  const encode = async (file) => (await readFile(file)).toString("base64");
  const fonts = [
    ["LGBaseFont", "LGBaseFont-Regular.woff2", "400", ""],
    ["LGBaseFont", "LGBaseFont-Bold.woff2", "500 700", ""],
    ["LGMono", "MonaspaceNeon.woff2", "400 700", "size-adjust:90%;"],
  ];
  const rules = [];
  for (const [family, file, weight, extra] of fonts) {
    rules.push(
      `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${await encode(path.join(root, "public/fonts", file))}) format("woff2");font-weight:${weight};font-style:normal;${extra}}`,
    );
  }
  const katex = path.join(root, "node_modules/katex/dist");
  let css = await readFile(path.join(katex, "katex.min.css"), "utf8");
  // Chromium 使用 WOFF2；每个字体面只保留这一份内嵌资源。
  for (const [declaration, file] of css.matchAll(
    /src:url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)[^;}]*;?/gu,
  )) {
    css = css.replace(
      declaration,
      `src:url(data:font/woff2;base64,${await encode(path.join(katex, file))}) format("woff2");`,
    );
  }
  await writeFile(path.join(output, "pdf-print.css"), rules.join("\n") + "\n" + css);
}
