import { AgentService } from "../agent/agent-service";
import { WebSearchService } from "../agent/web-search-service";
import { AgentWorkspaceService, type AgentWorkspaceRunPort } from "../agent/workspace/service";
import { ApiGatewayServer } from "../api/api-gateway-server";
import { ApiStreamHub } from "../api/api-stream-hub";
import type { OutputFolderOpener } from "../file/translation-file-export-service";
import { t_main_log } from "../log/log-text";
import type { SystemProxyResolver } from "../network/system-proxy-http-client";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import { AppError } from "../../shared/error";
import type { LogTargets } from "../../shared/log";
import { write_bootstrap_error } from "./bootstrap-log";
import { BackendResources } from "./backend-resources";
import { BackendServices } from "./backend-services";

type GuiBackendBootstrapState = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface GuiBackendBootstrapOptions {
  appRoot: string; // 安装根与便携数据位置
  builtinRoot: string; // 当前版本只读内置资产根
  logTargets?: Partial<LogTargets>; // GUI Backend 日志出口
  systemProxyResolver: SystemProxyResolver; // Electron main 提供的代理解析端口
  agentWorkspaceRun: AgentWorkspaceRunPort; // 固定 Deno runner 端口
  openOutputFolder: OutputFolderOpener; // Electron main 副作用端口
  workerExecution: BackendWorkerExecution; // 正式 worker_threads 与测试执行策略
}

export interface GuiBackendBootstrapStartResult {
  apiBaseUrl: string;
  backendServices: BackendServices;
  readAppLanguage: () => unknown;
}

/** GUI Backend 的完整组合根；Agent、SSE 与 Gateway 在该入口恒定存在。 */
export class GuiBackendBootstrap {
  private state: GuiBackendBootstrapState = "idle";
  private resources: BackendResources | null = null;
  private services: BackendServices | null = null;
  private event_stream: ApiStreamHub | null = null;
  private agent: AgentService | null = null;
  private web_search: WebSearchService | null = null;
  private gateway: ApiGatewayServer | null = null;
  private start_promise: Promise<GuiBackendBootstrapStartResult> | null = null;
  private stop_promise: Promise<void> | null = null;

  /** 保存入口注入的宿主端口，资源只在 start 中创建。 */
  public constructor(private readonly options: GuiBackendBootstrapOptions) {}

  /** idle、stopped 与已清理的 failed 都没有活动 GUI Backend 资源。 */
  public isStopped(): boolean {
    return this.state === "idle" || this.state === "stopped" || this.state === "failed";
  }

  /** 串行启动完整 GUI Backend，并处理启动期间到达的 stop。 */
  public async start(): Promise<GuiBackendBootstrapStartResult> {
    const stop_in_progress = this.stop_promise !== null;
    if ((this.state !== "idle" && this.state !== "stopped") || stop_in_progress) {
      throw new AppError("runtime.internal_invariant", {
        diagnostic_context: {
          reason: "gui_backend_bootstrap_start_invalid_state",
          state: this.state,
          stop_in_progress,
        },
      });
    }
    const starting = this.start_runtime();
    this.start_promise = starting;
    try {
      const result = await starting;
      const stopping = this.stop_promise;
      if (stopping !== null) {
        await stopping;
        throw new AppError("runtime.disposed", {
          diagnostic_context: { reason: "gui_backend_bootstrap_stopped_during_start" },
        });
      }
      return result;
    } finally {
      if (this.start_promise === starting) this.start_promise = null;
    }
  }

  /** 按共享资源、业务服务、Agent、Gateway 的顺序完成装配。 */
  private async start_runtime(): Promise<GuiBackendBootstrapStartResult> {
    this.state = "starting";
    try {
      const resources = await BackendResources.start(this.options);
      this.resources = resources;
      const event_stream = new ApiStreamHub();
      this.event_stream = event_stream;
      const services = new BackendServices({
        paths: resources.paths,
        metadata: resources.metadata,
        appSettingService: resources.settings,
        database: resources.database,
        logManager: resources.logManager,
        publishEvent: (topic, payload) => event_stream.publish(topic, payload),
        openOutputFolder: this.options.openOutputFolder,
        workerExecution: this.options.workerExecution,
      });
      this.services = services;
      const web_search = new WebSearchService(resources.metadata.read_version_or_default());
      this.web_search = web_search;
      const workspace = new AgentWorkspaceService({
        paths: resources.paths,
        settings: resources.settings,
        sessionState: services.state.session,
        cache: services.state.cache,
        proofreading: services.proofreading.query,
        database: resources.database,
        runtimeGate: services.state.runtimeGate,
        writeStore: services.state.writes,
        logManager: resources.logManager,
        run: this.options.agentWorkspaceRun,
      });
      const agent = new AgentService({
        paths: resources.paths,
        settings: resources.settings,
        userAgent: resources.metadata.build_linguagacha_user_agent(),
        sessionState: services.state.session,
        runtimeGate: services.state.runtimeGate,
        webSearch: web_search.search,
        workspace,
        logManager: resources.logManager,
        publish: (topic, payload) => event_stream.publish(topic, payload),
      });
      this.agent = agent;
      await agent.load_resources();
      resources.settings.set_stream_publisher(event_stream);
      const gateway = new ApiGatewayServer({
        backendServices: services,
        agentService: agent,
        eventStream: event_stream,
      });
      this.gateway = gateway;
      const gateway_result = await gateway.start();
      this.state = "ready";
      return {
        apiBaseUrl: gateway_result.baseUrl,
        backendServices: services,
        readAppLanguage: () => resources.settings.read_app_language(),
      };
    } catch (error) {
      this.state = "failed";
      const failures: unknown[] = [error];
      const log_manager = this.resources?.logManager;
      if (log_manager !== undefined) {
        try {
          write_bootstrap_error(
            t_main_log("app.diagnostic.lifecycle.backend_gateway_start_failed"),
            { error },
            log_manager,
          );
        } catch (log_error) {
          failures.push(log_error);
        }
      }
      await this.dispose_runtime(failures);
      if (failures.length > 1) {
        throw new AggregateError(failures, "GUI Backend startup and cleanup failed.");
      }
      throw error;
    }
  }

  /** 幂等等待在途启动并逆序释放当前已创建的资源。 */
  public async stop(): Promise<void> {
    if (this.stop_promise !== null) {
      await this.stop_promise;
      return;
    }
    const starting = this.start_promise;
    const stopping = (async () => {
      if (starting !== null) await starting.catch(() => undefined);
      const failures: unknown[] = [];
      await this.dispose_runtime(failures);
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to close GUI Backend resources.");
      }
    })();
    this.stop_promise = stopping;
    try {
      await stopping;
    } finally {
      if (this.stop_promise === stopping) this.stop_promise = null;
    }
  }

  /** 单项清理失败不跳过后续资源，最终由调用方统一汇总。 */
  private async dispose_runtime(failures: unknown[]): Promise<void> {
    if (this.state === "stopped" && this.resources === null) return;
    this.state = "stopping";
    const gateway = this.gateway;
    this.gateway = null;
    await collect_failure(failures, async () => await gateway?.stop());

    this.resources?.settings.set_stream_publisher(null);
    const agent = this.agent;
    this.agent = null;
    await collect_failure(failures, async () => await agent?.dispose());

    const web_search = this.web_search;
    this.web_search = null;
    await collect_failure(failures, async () => await web_search?.dispose());

    this.event_stream?.stop();
    this.event_stream = null;

    const services = this.services;
    this.services = null;
    await collect_failure(failures, async () => await services?.dispose());

    const resources = this.resources;
    this.resources = null;
    await collect_failure(failures, async () => await resources?.dispose());
    this.state = "stopped";
  }
}

/** 将一次清理失败追加到共享生命周期结果。 */
async function collect_failure(
  failures: unknown[],
  operation: () => void | Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}
