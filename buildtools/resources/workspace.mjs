import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";
import { keep_workspace_package_path } from "./package-files.mjs";

// 这些目录只属于应用代码构建，依赖准备与开发缓存均排除它们。
export const WORKSPACE_CODE_DIRECTORIES = ["runtime", "chunks", "node_modules/@lg"];

// 应用 SDK 随应用发布，公开入口与私有启动入口共用一个构建图。
const WORKSPACE_PACKAGES = [
  {
    name: "@lg/project",
    entries: {
      index: "src/backend/agent/project/index.ts",
      "item-contexts": "src/backend/agent/project/item-contexts.ts",
    },
  },
  {
    name: "@lg/utils",
    entries: { "literal-matcher": "src/shared/text/literal-matcher.ts" },
  },
  { name: "@lg/uv", entries: { index: "src/backend/agent/uv/index.ts" } },
  { name: "@lg/npm", entries: { index: "src/backend/agent/npm/index.ts" } },
  { name: "@lg/media", entries: { index: "src/backend/agent/media/index.ts" } },
  {
    name: "@lg/pdf",
    entries: {
      index: "src/backend/agent/pdf/index.ts",
      "page-updates": "src/backend/agent/workspace/page-updates.ts",
      mupdf: "src/backend/file/pdf/mupdf.ts",
    },
  },
];

/** 所有应用入口一次构建，共同依赖生成共享 chunk，MuPDF 保留单一外部安装。 */
export async function build_workspace_resources({ root, output, manifest }) {
  for (const directory of WORKSPACE_CODE_DIRECTORIES)
    await rm(path.join(output, directory), { recursive: true, force: true });
  const entries = {
    "runtime/bootstrap": "src/backend/agent/workspace/runtime/bootstrap.ts",
    "runtime/prepare": "src/backend/agent/node/prepare.ts",
    "runtime/pdf-worker": "src/backend/file/pdf/pdf-worker-entry.ts",
    "runtime/media-worker": "src/backend/agent/media/worker.ts",
  };
  for (const definition of WORKSPACE_PACKAGES) {
    const { name, entries: package_entries } = definition;
    const directory = path.join(output, "node_modules", name);
    const publicManifest = {
      name,
      private: true,
      type: "module",
      exports: Object.fromEntries(
        Object.keys(package_entries).map((entry) => [
          entry === "index" ? "." : `./${entry}`,
          `./${entry}.mjs`,
        ]),
      ),
    };
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify(publicManifest, null, 2));
    for (const [entry, source] of Object.entries(package_entries))
      entries[`node_modules/${name}/${entry}`] = source;
  }
  await build({
    configFile: false,
    resolve: { conditions: ["node"], mainFields: ["module", "main"] },
    publicDir: false,
    build: {
      target: "node24",
      outDir: output,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: Object.fromEntries(
          Object.entries(entries).map(([key, file]) => [key, path.join(root, file)]),
        ),
        formats: ["es"],
        fileName: (_format, name) => `${name}.mjs`,
      },
      rolldownOptions: {
        platform: "node",
        external: [...builtinModules, /^node:/u, ...manifest.workspaceRuntimePackages.backend],
        output: { chunkFileNames: "chunks/[name]-[hash].mjs" },
      },
    },
  });
  // 媒体前后处理 helper 由 `@lg/media` 以受控解释器直接运行。
  for (const file of ["media.py", "fsmn_vad.py", "visualize.py"])
    await cp(path.join(root, "src/backend/agent/media", file), path.join(output, "runtime", file));
}

/** npm 拥有依赖解析，这里只复制后端依赖闭包，不清理其它步骤的产物。 */
export async function deploy_workspace_dependencies({ root, output, names, runNpm }) {
  const modules = path.join(root, "node_modules");
  const selected = `:root > :is(${names.map((name) => `[name=${JSON.stringify(name)}]`).join(",")})`;
  const packages = JSON.parse(
    (await runNpm(root, ["query", `${selected}, ${selected} *`, "--json"])).toString(),
  );
  const dependencies = Object.fromEntries(
    names.map((name) => {
      const installed = packages.find((pkg) => pkg.location === `node_modules/${name}`);
      if (!installed)
        throw new Error(`Workspace dependency is not installed: ${name}. Run npm ci.`);
      return [name, installed.version];
    }),
  );
  await mkdir(output, { recursive: true });
  for (const pkg of packages) {
    const source = path.resolve(root, pkg.location);
    const relative = path.relative(modules, source);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`Workspace dependency is outside node_modules: ${pkg.location}`);
    await cp(source, path.join(output, pkg.location), {
      recursive: true,
      filter: (entry) => {
        const relative = path.relative(source, entry).split(path.sep).join("/");
        return relative !== "node_modules" && keep_workspace_package_path(pkg.name, relative);
      },
    });
  }
  await writeFile(
    path.join(output, "package.json"),
    JSON.stringify({ name: "lg-workspace", private: true, type: "module", dependencies }, null, 2),
  );
}
