import { execa } from "execa";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploy_workspace_tools } from "../builder/native-tools.mjs";
import lockfile from "proper-lockfile";
import { build_workspace_resources, deploy_workspace_dependencies } from "./workspace.mjs";
import { build_node_resources } from "./node.mjs";
import { build_pdf_print_resources } from "./pdf-print.mjs";
import { remove_license_files } from "./license-files.mjs";
import { prepare_development_resources, read_development_inputs } from "./development-cache.mjs";

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
  const runNpm = async (cwd, args) =>
    (
      await execa(process.execPath, [npm, ...args], {
        cwd,
        env: { ...process.env, NODE_OPTIONS: "" },
        windowsHide: true,
        stdio: "pipe",
        maxBuffer: 16 * 1024 * 1024,
      })
    ).stdout;
  await mkdir(path.dirname(output), { recursive: true });
  // 锁位于输出目录旁，清理资源时仍保护唯一写入口。
  const release = await lockfile.lock(output, { realpath: false });
  try {
    const workspace = path.join(output, "workspace");
    const prepare = async () => {
      await rm(output, { recursive: true, force: true });
      await mkdir(output, { recursive: true });
      await deploy_workspace_dependencies({
        root,
        output: workspace,
        names: manifest.workspaceRuntimePackages.backend,
        runNpm,
      });
      await mkdir(path.join(workspace, "python"), { recursive: true });
      await cp(
        path.join(root, "node_modules/tree-sitter-python/tree-sitter-python.wasm"),
        path.join(workspace, "python/tree-sitter-python.wasm"),
      );
      await build_node_resources({ root, output: workspace, manifest, lock, runNpm });
      await build_pdf_print_resources(root, output);
      if (development)
        await deploy_workspace_tools({
          root,
          workspaceDirectory: workspace,
          platform: process.platform,
          arch: process.arch,
        });
      await remove_license_files(output);
    };
    if (development)
      await prepare_development_resources({
        output,
        inputs: await read_development_inputs(root),
        prepare,
      });
    else await prepare();
    await build_workspace_resources({ root, output: workspace, manifest });
  } finally {
    await release();
  }
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
