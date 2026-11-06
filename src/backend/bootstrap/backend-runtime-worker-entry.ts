import { parentPort, workerData } from "node:worker_threads";

import { is_app_language } from "../../domain/app-language";
import { run_backend_runtime } from "./backend-runtime";

// 入口只收窄 `workerData`。`backend-runtime` 负责生命周期和协议处理。
if (parentPort === null) {
  throw new Error("Backend runtime worker is missing parentPort.");
}

const data = workerData as Record<string, unknown>;

/** 路径字段都由宿主解析后注入，缺失或为空说明入口装配错误。 */
function read_path(key: string): string {
  const value = data[key];
  if (typeof value !== "string" || value === "")
    throw new Error(`Backend runtime worker is missing ${key}.`);
  return value;
}

const appRoot = read_path("appRoot");
const builtinRoot = read_path("builtinRoot");
const workspaceRuntimeDirectory = read_path("workspaceRuntimeDirectory");
const fontsDirectory = read_path("fontsDirectory");
const defaultAppLanguage = data["defaultAppLanguage"];
if (!is_app_language(defaultAppLanguage)) {
  throw new Error("Backend runtime worker is missing a valid defaultAppLanguage.");
}

void run_backend_runtime({
  defaultAppLanguage,
  appRoot,
  builtinRoot,
  workspaceRuntimeDirectory,
  fontsDirectory,
  moduleUrl: import.meta.url,
  port: parentPort,
});
