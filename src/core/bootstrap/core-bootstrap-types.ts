import type { CoreServices } from "./core-services";
import type { WorkerPoolExecution } from "../engine/worker/worker-execution";
import type { LogTargets } from "../../shared/log";

export type CoreBootstrapState = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface CoreLaunchEnvironment {
  env: NodeJS.ProcessEnv;
  appRoot: string;
  platform: NodeJS.Platform;
}

export interface CoreBootstrapStartResult {
  apiBaseUrl: string | null;
  coreServices: CoreServices; // coreServices 只暴露给同进程入口适配器，不进入 renderer 协议
  readAppLanguage: () => unknown; // Electron 宿主只拿语言读取窄入口，不持有设置服务
}

export interface CoreBootstrapOptions {
  appRoot: string;
  exposeApiGateway: boolean;
  logTargets?: Partial<LogTargets>; // logTargets 由入口适配器选择，CLI 会关闭控制台避免污染 JSONL stdout
  openOutputFolder: (outputPath: string) => Promise<void>;
  workerExecution: WorkerPoolExecution; // workerExecution 固定任务执行模式，避免服务层自行回退或探测入口。
}
