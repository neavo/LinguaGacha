import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prune_workspace_package_files } from "./package-files.mjs";

/** npm 构建规范的可搬移安装树，发布依赖与用户依赖分别拥有自己的目录。 */
export async function build_node_resources({ root, output, manifest, lock, packages, runNpm }) {
  await cp(path.join(root, "node_modules/npm"), path.join(output, "npm"), { recursive: true });
  const seed = path.join(output, "seed");
  await mkdir(path.join(seed, "packages"), { recursive: true });
  const app_packages = [];
  for (const { name, directory } of packages) {
    const package_manifest = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
    package_manifest.bundleDependencies = Object.keys(package_manifest.dependencies ?? {});
    await writeFile(path.join(directory, "package.json"), JSON.stringify(package_manifest));
    if (package_manifest.bundleDependencies.length > 0) {
      await cp(path.join(root, "package-lock.json"), path.join(directory, "package-lock.json"));
      runNpm(directory, [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ]);
      runNpm(directory, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
      await prune_workspace_package_files(directory);
    }
    await rm(path.join(directory, "package-lock.json"), { force: true });
    const digest = createHash("sha256");
    await hash_directory(directory, digest);
    package_manifest.version = `0.0.0-lg.h${digest.digest("hex").slice(0, 24)}`;
    await writeFile(path.join(directory, "package.json"), JSON.stringify(package_manifest));
    const packed = JSON.parse(
      runNpm(directory, [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        path.join(seed, "packages"),
      ]).toString(),
    );
    app_packages.push({
      name,
      version: package_manifest.version,
      path: `packages/${packed[name].filename}`,
    });
  }
  const dependencies = Object.fromEntries(
    manifest.workspaceRuntimePackages.agent.map((name) => [
      name,
      lock.packages[`node_modules/${name}`].version,
    ]),
  );
  for (const pkg of app_packages) dependencies[pkg.name] = `file:${pkg.path}`;
  await writeFile(
    path.join(seed, "package.json"),
    JSON.stringify(
      {
        name: "lg-agent-node",
        private: true,
        type: "module",
        dependencies,
        overrides: manifest.overrides,
      },
      null,
      2,
    ),
  );
  await cp(path.join(root, "package-lock.json"), path.join(seed, "package-lock.json"));
  runNpm(seed, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  runNpm(seed, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  await prune_workspace_package_files(seed);
  await writeFile(path.join(output, "app-packages.json"), JSON.stringify(app_packages, null, 2));
}

/** 先排序再计算内容版本，文件系统的枚举顺序不参与版本判断。 */
async function hash_directory(directory, digest, prefix = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      await hash_directory(path.join(directory, entry.name), digest, `${name}/`);
    else {
      digest.update(name);
      digest.update(await readFile(path.join(directory, entry.name)));
    }
  }
}
