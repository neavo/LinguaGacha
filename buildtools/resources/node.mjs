import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prune_workspace_package_files } from "./package-files.mjs";

/** npm 构建规范的可搬移安装树，发布依赖与用户依赖分别拥有自己的目录。 */
export async function build_node_resources({ root, output, manifest, lock, runNpm }) {
  await cp(path.join(root, "node_modules/npm"), path.join(output, "npm"), { recursive: true });
  const seed = path.join(output, "seed");
  await mkdir(seed, { recursive: true });
  const dependencies = Object.fromEntries(
    manifest.workspaceRuntimePackages.agent.map((name) => [
      name,
      lock.packages[`node_modules/${name}`].version,
    ]),
  );
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
}
