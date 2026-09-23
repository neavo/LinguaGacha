import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

// Node 入口使用 `exceljs/lib` 和原始 MuPDF WASM，按包排除对应的替代构建。
const PACKAGE_EXCLUDED_PATH = {
  exceljs: "dist",
  mupdf: "dist/mupdf-wasm.wasm.br",
};

/** npm 拥有依赖解析；部署保留实际安装位置，让嵌套版本按标准 Node 规则加载。 */
export async function deploy_workspace_dependencies(root, output) {
  root = path.resolve(root);
  output = path.resolve(output);
  // 输出目录由构建独占并整体重建，拒绝清理项目本身或安装源。
  const modules = path.join(root, "node_modules");
  if (is_inside(output, root) || is_inside(modules, output))
    throw new Error(`Workspace output overlaps its source: ${output}`);

  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const names = manifest.workspacePackages;
  const selected = `:root > :is(${names.map((name) => `[name=${JSON.stringify(name)}]`).join(",")})`;
  const { stdout } = await execa("npm", ["query", `${selected}, ${selected} *`, "--json"], {
    cwd: root,
    windowsHide: true,
  });
  const packages = JSON.parse(stdout);
  const dependencies = Object.fromEntries(
    names.map((name) => {
      const installed = packages.find((pkg) => pkg.location === `node_modules/${name}`);
      if (!installed)
        throw new Error(`Workspace dependency is not installed: ${name}. Run npm ci.`);
      return [name, installed.version];
    }),
  );

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const pkg of packages) {
    const source = path.resolve(root, pkg.location);
    if (!is_inside(modules, source))
      throw new Error(`Workspace dependency is outside node_modules: ${pkg.location}`);
    await cp(source, path.join(output, pkg.location), {
      recursive: true,
      // 嵌套 node_modules 由查询结果逐包部署，避免带入未选中的旧安装包。
      filter: (entry) => {
        const relative = path.relative(source, entry).split(path.sep).join("/");
        return (
          relative !== "node_modules" &&
          !relative.endsWith(".map") &&
          relative !== PACKAGE_EXCLUDED_PATH[pkg.name]
        );
      },
    });
  }
  await writeFile(
    path.join(output, "package.json"),
    `${JSON.stringify(
      {
        name: "lg-workspace",
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
}

// path.relative 同时处理 Windows 路径大小写与不同驱动器。
function is_inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
