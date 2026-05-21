import type { CoreServices } from "./core-services";
import type { EngineExecution } from "../engine/core/engine-execution";
import type { LogTargets } from "../../shared/log";
import type { SystemProxyResolver, SystemProxyStartupNotice } from "./system-proxy-dispatcher";

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
  systemProxyStartupNotice: SystemProxyStartupNotice; // systemProxyStartupNotice 是脱敏启动提示摘要，GUI/CLI 只消费它
}

export interface CoreBootstrapOptions {
  appRoot: string;
  exposeApiGateway: boolean;
  logTargets?: Partial<LogTargets>; // logTargets 由入口适配器选择，CLI 会关闭控制台避免污染 JSONL stdout
  systemProxyResolver?: SystemProxyResolver; // systemProxyResolver 由 Electron 入口注入，Bootstrap 只消费启动期系统代理快照
  openOutputFolder: (outputPath: string) => Promise<void>;
  engineExecution: EngineExecution; // engineExecution 固定任务执行模式，避免服务层自行回退或探测入口。
}
