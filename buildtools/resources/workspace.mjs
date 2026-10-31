import { cp, mkdir, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";
import { keep_workspace_package_path } from "./package-files.mjs";

// 公开入口和可信入口在构建时分开，种子只接收公开包产物。
const WORKSPACE_PACKAGES = [
  {
    name: "@lg/workspace",
    entries: {
      "item-contexts": "src/backend/agent/workspace/runtime/item-contexts.ts",
      "page-updates": "src/backend/agent/workspace/page-updates.ts",
    },
    runtimeEntries: {
      bootstrap: "src/backend/agent/workspace/runtime/bootstrap.ts",
      prepare: "src/backend/agent/node/prepare.ts",
    },
  },
  { name: "@lg/text", entries: { index: "src/shared/text/literal-matcher.ts" } },
  {
    name: "@lg/pdf",
    entries: {
      index: "src/backend/file/pdf/pdf-document.ts",
      worker: "src/backend/file/pdf/pdf-worker-entry.ts",
    },
    dependencies: ["mupdf"],
  },
];

/** 公开包作为种子输入，可信入口只构建到发布目录。 */
export async function build_workspace_resources({
  root,
  output,
  packagesDirectory,
  manifest,
  lock,
  runNpm,
}) {
  await deploy_workspace_dependencies({
    root,
    output,
    names: manifest.workspaceRuntimePackages.backend,
    runNpm,
  });
  await mkdir(path.join(output, "python"), { recursive: true });
  for (const name of ["tree-sitter-python.wasm", "LICENSE"])
    await cp(
      path.join(root, "node_modules/tree-sitter-python", name),
      path.join(output, "python", name),
    );
  const packages = [];
  for (const definition of WORKSPACE_PACKAGES) {
    const { name, entries, runtimeEntries = {} } = definition;
    const dependencies = Object.fromEntries(
      (definition.dependencies ?? []).map((dependency) => [
        dependency,
        lock.packages[`node_modules/${dependency}`].version,
      ]),
    );
    const directory = path.join(packagesDirectory, name);
    const publicManifest = {
      name,
      private: true,
      type: "module",
      exports: package_exports(entries),
      dependencies,
    };
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify(publicManifest, null, 2));
    await build_package(root, directory, entries, dependencies);
    packages.push({ name, directory });
    const published = path.join(output, "node_modules", name);
    await cp(directory, published, { recursive: true });
    if (Object.keys(runtimeEntries).length > 0) {
      await build_package(root, published, runtimeEntries, dependencies);
      await writeFile(
        path.join(published, "package.json"),
        JSON.stringify(
          {
            ...publicManifest,
            exports: { ...publicManifest.exports, ...package_exports(runtimeEntries) },
          },
          null,
          2,
        ),
      );
    }
  }
  return packages;
}

/** npm 拥有依赖解析，这里只复制后端依赖闭包，不清理其它步骤的产物。 */
export async function deploy_workspace_dependencies({ root, output, names, runNpm }) {
  const modules = path.join(root, "node_modules");
  const selected = `:root > :is(${names.map((name) => `[name=${JSON.stringify(name)}]`).join(",")})`;
  const packages = JSON.parse(
    runNpm(root, ["query", `${selected}, ${selected} *`, "--json"]).toString(),
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

/** 每个包只公开本次入口集合，可信入口与用户包分别生成导出。 */
function package_exports(entries) {
  return Object.fromEntries(
    Object.keys(entries).map((name) => [name === "index" ? "." : `./${name}`, `./${name}.mjs`]),
  );
}

/** 第三方运行依赖留给 npm 部署，内部业务源码合并进应用包。 */
async function build_package(root, directory, entries, dependencies) {
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
        fileName: (_format, name) => `${name}.mjs`,
      },
      rolldownOptions: {
        platform: "node",
        external: [...builtinModules, /^node:/u, ...Object.keys(dependencies)],
        output: {
          codeSplitting: Object.keys(entries).length > 1,
          chunkFileNames: "chunks/[name]-[hash].mjs",
        },
      },
    },
  });
}
