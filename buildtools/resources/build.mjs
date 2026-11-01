import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploy_workspace_tools } from "../builder/native-tools.mjs";
import { build_workspace_resources } from "./workspace.mjs";
import { build_node_resources } from "./node.mjs";
import { build_pdf_print_resources } from "./pdf-print.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** 资源入口独占输出根目录，各步骤只写自己的产物，原生工具按运行场景部署。 */
export async function build_resources({
  root = PROJECT_ROOT,
  output = path.join(root, "build/resources"),
  development = false,
} = {}) {
  root = path.resolve(root);
  output = path.resolve(output);
  const default_output = path.join(root, "build/resources");
  // 仓库内只清理约定的资源根，外部输出也不能包含源码工程。
  if (
    path.relative(default_output, output) !== "" &&
    (is_inside(root, output) || is_inside(output, root))
  )
    throw new Error(`Resource output overlaps its source: ${output}`);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const npm = path.join(root, "node_modules/npm/bin/npm-cli.js");
  const runNpm = (cwd, args) =>
    execFileSync(process.execPath, [npm, ...args], {
      cwd,
      env: { ...process.env, NODE_OPTIONS: "" },
      windowsHide: true,
      stdio: "pipe",
      maxBuffer: 16 * 1024 * 1024,
    });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const workspace = path.join(output, "workspace");
  await build_workspace_resources({ root, output: workspace, manifest, runNpm });
  await build_node_resources({ root, output: workspace, manifest, lock, runNpm });
  await build_pdf_print_resources(root, output);
  if (development)
    await deploy_workspace_tools({
      root,
      workspaceDirectory: workspace,
      platform: process.platform,
      arch: process.arch,
    });
}

/** 按路径段判断重叠，避免清理输出时覆盖源码或依赖。 */
function is_inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outputs = args.filter((arg) => arg !== "--development");
  if (outputs.length > 1 || outputs.some((arg) => arg.startsWith("--")))
    throw new Error(
      "Usage: node buildtools/resources/build.mjs [output-directory] [--development]",
    );
  await build_resources({ output: outputs[0], development: args.includes("--development") });
}
