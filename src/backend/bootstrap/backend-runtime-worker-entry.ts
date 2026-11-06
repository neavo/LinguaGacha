import { parentPort, workerData } from "node:worker_threads";

import { is_app_language } from "../../domain/app-language";
import { run_backend_runtime } from "./backend-runtime";

// 入口只收窄 `workerData`。`backend-runtime` 负责生命周期和协议处理。
if (parentPort === null) {
  throw new Error("Backend runtime worker is missing parentPort.");
}

const data = workerData as {
  appRoot?: unknown;
  defaultAppLanguage?: unknown;
  builtinRoot?: unknown;
  workspaceRuntimeDirectory?: unknown;
};
if (typeof data.appRoot !== "string" || data.appRoot === "") {
  throw new Error("Backend runtime worker is missing appRoot.");
}
if (typeof data.builtinRoot !== "string" || data.builtinRoot === "") {
  throw new Error("Backend runtime worker is missing builtinRoot.");
}
if (typeof data.workspaceRuntimeDirectory !== "string" || data.workspaceRuntimeDirectory === "") {
  throw new Error("Backend runtime worker is missing workspaceRuntimeDirectory.");
}

if (!is_app_language(data.defaultAppLanguage)) {
  throw new Error("Backend runtime worker is missing a valid defaultAppLanguage.");
}

void run_backend_runtime({
  defaultAppLanguage: data.defaultAppLanguage,
  appRoot: data.appRoot,
  builtinRoot: data.builtinRoot,
  workspaceRuntimeDirectory: data.workspaceRuntimeDirectory,
  moduleUrl: import.meta.url,
  port: parentPort,
});
