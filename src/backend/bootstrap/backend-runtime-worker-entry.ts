import { parentPort, workerData } from "node:worker_threads";

import { run_backend_runtime } from "./backend-runtime";

// 入口只负责收窄 workerData；完整生命周期和协议处理统一留在 backend-runtime。
if (parentPort === null) {
  throw new Error("Backend runtime worker is missing parentPort.");
}

const data = workerData as { appRoot?: unknown; builtinRoot?: unknown };
if (typeof data.appRoot !== "string" || data.appRoot === "") {
  throw new Error("Backend runtime worker is missing appRoot.");
}
if (typeof data.builtinRoot !== "string" || data.builtinRoot === "") {
  throw new Error("Backend runtime worker is missing builtinRoot.");
}

void run_backend_runtime({
  appRoot: data.appRoot,
  builtinRoot: data.builtinRoot,
  moduleUrl: import.meta.url,
  port: parentPort,
});
