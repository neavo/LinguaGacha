import { readdir, rm } from "node:fs/promises";
import path from "node:path";

// 发布环境使用 Node 入口和原始 WASM，浏览器替代构建及 source map 不参与运行。
const PACKAGE_EXCLUDED_PATH = {
  exceljs: "dist",
  mupdf: "dist/mupdf-wasm.wasm.br",
};

/** 资源规则同时用于复制和安装树裁剪，避免两种产物保留不同文件。 */
export function keep_workspace_package_path(name, relative) {
  return !relative.endsWith(".map") && relative !== PACKAGE_EXCLUDED_PATH[name];
}

/** 仅处理构建拥有的安装树，让发布依赖、应用 tgz 和初始种子采用同一资源规则。 */
export async function prune_workspace_package_files(project) {
  await prune_modules(path.join(project, "node_modules"));
}

/** 按安装位置识别包名，链接不参与递归裁剪。 */
async function prune_modules(directory, scope = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) await prune_modules(target, `${entry.name}/`);
    else await prune_package(target, `${scope}${entry.name}`);
  }
}

/** 嵌套依赖独立采用自身包规则，父包的裁剪范围不能覆盖它们。 */
async function prune_package(directory, name, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const entry_path = path.posix.join(relative, entry.name);
    if (!keep_workspace_package_path(name, entry_path)) {
      await rm(target, { recursive: entry.isDirectory() });
    } else if (entry.isDirectory()) {
      if (entry.name === "node_modules") await prune_modules(target);
      else await prune_package(target, name, entry_path);
    }
  }
}
