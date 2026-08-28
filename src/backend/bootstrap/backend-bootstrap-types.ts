import type { BackendServices } from "./backend-services";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import type { LogTargets } from "../../shared/log";
import type { SystemProxyResolver } from "../network/system-proxy-http-client";
import type { AgentWebFetchPort } from "../agent/agent-web-fetch";
import type { AgentWorkspaceRunPort } from "../agent/agent-workspace-service";
import type { PdfRenderPort } from "../file/formats/file-format-shared";

export type BackendBootstrapState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

export interface BackendBootstrapStartResult {
  apiBaseUrl: string | null;
  backendServices: BackendServices; // 只暴露给同进程入口适配器，不进入 renderer 协议
  readAppLanguage: () => unknown; // Electron 宿主只拿语言读取窄入口，不持有设置服务
}

export interface BackendBootstrapOptions {
  appRoot: string;
  exposeApiGateway: boolean;
  logTargets?: Partial<LogTargets>; // 由入口适配器选择，CLI 会关闭控制台避免污染 JSONL stdout
  systemProxyResolver: SystemProxyResolver; // GUI/CLI 入口都必须提供当前 Electron 系统代理解析
  agentWebFetch?: AgentWebFetchPort; // 仅 GUI 注入 Backend 抓取入口；其它入口不提供该能力
  agentWorkspaceRun?: AgentWorkspaceRunPort; // 仅 GUI 注入 Electron 沙箱脚本执行能力
  openOutputFolder: (outputPath: string) => Promise<void>;
  renderPdf: PdfRenderPort;
  workerExecution: BackendWorkerExecution; // 固定 Backend worker 执行配置，避免服务层自行回退或探测入口。
}
