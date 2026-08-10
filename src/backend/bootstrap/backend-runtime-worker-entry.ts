import { parentPort, workerData } from "node:worker_threads";

import { run_backend_runtime } from "./backend-runtime";

// 入口只负责收窄 workerData；完整生命周期和协议处理统一留在 backend-runtime。
if (parentPort === null) {
  throw new Error("Backend runtime worker is missing parentPort.");
}

const data = workerData as { appRoot?: unknown };
if (typeof data.appRoot !== "string" || data.appRoot === "") {
  throw new Error("Backend runtime worker is missing appRoot.");
}

void run_backend_runtime({ appRoot: data.appRoot, moduleUrl: import.meta.url, port: parentPort });
