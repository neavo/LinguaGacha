import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { npm } from "../npm";
import { uv } from "../uv";
import { default_native_fs as fs } from "../../../native/native-fs";
export const ORT_PACKAGE = "onnxruntime-node";
export const INFERENCE_DEPENDENCIES = Object.freeze({
  ort: "1.30.0",
  numpy: "2.5.4",
  opencv: "5.0.0.93",
});
/** 根线程只解析 ORT，原生模块始终在 Worker 中导入。 */
export function ort_entry(): string {
  const root = path.join(npm.directory, "node_modules", ORT_PACKAGE);
  const entry = createRequire(path.join(npm.directory, "package.json")).resolve(ORT_PACKAGE);
  const relative = path.relative(root, entry);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${ORT_PACKAGE} resolved outside the shared npm project: ${entry}`);
  return pathToFileURL(entry).href;
}

/** 使用显式准备的共享解释器，计算期间不安装或同步依赖。 */
export function python(): string {
  const executable = path.join(
    uv.directory,
    ".venv",
    ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  if (!fs.exists(executable))
    throw new Error(
      `Python environment is missing: ${executable}; run uv sync --inexact through @lg/uv first.`,
    );
  return executable;
}
