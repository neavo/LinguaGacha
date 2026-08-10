import { ApiGatewayServer } from "../api/api-gateway-server";
import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { set_main_log_language_reader, t_main_log } from "../log/log-text";
import { migration_orchestrator } from "../migration/migration-orchestrator";
import {
  read_config_model_preset_records,
  read_config_model_records,
} from "../model/model-config-resolver";
import { AppError } from "../../shared/error";
import { resolve_app_root } from "../app/app-root-resolver";
import { write_bootstrap_error, write_bootstrap_log } from "./bootstrap-log";
import { BackendServices } from "./backend-services";
import {
  EMPTY_SYSTEM_PROXY_STARTUP_NOTICE,
  build_system_proxy_startup_notice,
  collect_system_proxy_urls,
  install_system_proxy_dispatcher,
  type InstalledSystemProxyDispatcher,
  type SystemProxySnapshot,
  type SystemProxyStartupNotice,
} from "../llm/llm-system-proxy-dispatcher";
import type {
  BackendBootstrapOptions,
  BackendBootstrapStartResult,
  BackendBootstrapState,
} from "./backend-bootstrap-types";

/**
 * BackendBootstrap 持有 Backend 进程内资源的启动、服务组合和关闭顺序。
 */
export class BackendBootstrap {
  private state: BackendBootstrapState = "idle"; // 防止启动、退出和异常收尾并发重入同一资源链路
  private readonly options: BackendBootstrapOptions; // 来自 GUI/CLI 入口层，Bootstrap 只消费宿主注入事实
  private gateway_server: ApiGatewayServer | null = null; // 只在 GUI 模式暴露 `/api/*`
  private backend_services: BackendServices | null = null; // API Gateway 与 CLI job 的共享业务组合根
  private readonly database = new ProjectDatabase(); // 直接承载 `.lg` 物理 workflow，由 Bootstrap 统一关闭
  private log_manager: LogManager | null = null; // 先于服务组合创建，确保启动失败和退出阶段都有统一日志出口
  private system_proxy_dispatcher: InstalledSystemProxyDispatcher | null = null; // 只在入口注入 resolver 时安装
  private system_proxy_snapshot: SystemProxySnapshot | null = null; // 会传给 work unit worker 线程复用
  private system_proxy_startup_notice: SystemProxyStartupNotice = EMPTY_SYSTEM_PROXY_STARTUP_NOTICE; // 给 GUI/CLI 的脱敏启动提示摘要
  private start_promise: Promise<BackendBootstrapStartResult> | null = null; // stop 必须等待启动链发布完资源后再逆序释放
  private stop_promise: Promise<void> | null = null; // 所有退出入口 join 同一次关闭，不能把 stopping 当成已完成

  /**
   * Bootstrap 只接收入口层参数，路径、端口和运行期资源句柄由自身拥有。
   */
  public constructor(options: BackendBootstrapOptions) {
    this.options = options;
  }

  /**
   * 入口退出钩子只需要终态判断，避免重复进入 stop 收尾链路。
   */
  public isStopped(): boolean {
    return this.state === "idle" || this.state === "stopped" || this.state === "failed";
  }

  /**
   * 启动顺序固定为 LogManager -> ProjectDatabase -> BackendServices -> 可选 API Gateway。
   */
  public async start(): Promise<BackendBootstrapStartResult> {
    const stop_in_progress = this.stop_promise !== null;
    if ((this.state !== "idle" && this.state !== "stopped") || stop_in_progress) {
      throw new AppError("runtime.internal_invariant", {
        diagnostic_context: {
          reason: "backend_bootstrap_start_invalid_state",
          state: this.state,
          stop_in_progress,
        },
      });
    }
    const starting = this.start_services();
    this.start_promise = starting;
    try {
      const result = await starting;
      const stopping = this.stop_promise;
      if (stopping !== null) {
        await stopping;
        throw new AppError("runtime.disposed", {
          diagnostic_context: {
            reason: "backend_bootstrap_stopped_during_start",
          },
        });
      }
      return result;
    } finally {
      if (this.start_promise === starting) {
        this.start_promise = null;
      }
    }
  }

  /**
   * 单次启动实现与公开 Promise 分离，让 stop 能等待完整启动或失败收尾。
   */
  private async start_services(): Promise<BackendBootstrapStartResult> {
    this.state = "starting";
    const app_root = this.resolve_app_root();
    const paths = new AppPathService({ appRoot: app_root });
    const metadata = new AppMetadataService(paths);
    const log_manager = new LogManager({
      logDir: paths.get_log_dir(),
      targets: this.options.logTargets,
    });
    this.log_manager = log_manager;

    try {
      write_bootstrap_log("", log_manager);
      write_bootstrap_log(
        t_main_log("app.log.app_version", { VERSION: metadata.read_version() }),
        log_manager,
      );
      // 启动期迁移必须早于服务启动，确保配置和预设读取只看到当前 userdata/resource 布局。
      migration_orchestrator.run_startup_migrations({ paths, log_manager });
      const app_setting_service = new AppSettingService(paths);
      set_main_log_language_reader(() => app_setting_service.read_app_language());
      await this.install_system_proxy_snapshot(paths, app_setting_service);
      const backend_services = new BackendServices({
        paths,
        metadata,
        appSettingService: app_setting_service,
        database: this.database,
        logManager: log_manager,
        systemProxySnapshot: this.system_proxy_snapshot,
        ...(this.options.agentWebFetch === undefined
          ? {}
          : { agentWebFetch: this.options.agentWebFetch }),
        ...(this.options.agentWorkspaceRun === undefined
          ? {}
          : { agentWorkspaceRun: this.options.agentWorkspaceRun }),
        openOutputFolder: this.options.openOutputFolder,
        workerExecution: this.options.workerExecution,
      });
      this.backend_services = backend_services;
      await backend_services.agent.load_resources();
      backend_services.start();
      const api_base_url = this.options.exposeApiGateway
        ? await this.start_gateway(backend_services)
        : null;
      this.state = "ready";
      // Electron shell 的系统 dialog 不能走 renderer i18n，因此只返回语言读取窄入口。
      return {
        apiBaseUrl: api_base_url,
        backendServices: backend_services,
        readAppLanguage: () => app_setting_service.read_app_language(),
        systemProxyStartupNotice: this.system_proxy_startup_notice,
      };
    } catch (error) {
      this.state = "failed";
      const failures: unknown[] = [error];
      try {
        write_bootstrap_error(
          t_main_log("app.diagnostic.lifecycle.backend_gateway_start_failed"),
          { error },
          log_manager,
        );
      } catch (log_error) {
        failures.push(log_error);
      }
      try {
        await this.stop_services();
      } catch (cleanup_error) {
        failures.push(cleanup_error);
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "Backend startup failed and diagnostics or cleanup also failed.",
        );
      }
      throw error;
    }
  }

  /**
   * 退出请求统一汇入 stop，避免 GUI 事件和 CLI job 各自清理 Backend 资源。
   */
  public async stop(): Promise<void> {
    if (this.stop_promise !== null) {
      await this.stop_promise;
      return;
    }
    const starting = this.start_promise;
    const stopping = (async () => {
      if (starting !== null) {
        await starting.catch(() => undefined);
      }
      await this.stop_services();
    })();
    this.stop_promise = stopping;
    try {
      await stopping;
    } finally {
      if (this.stop_promise === stopping) {
        this.stop_promise = null;
      }
    }
  }

  /**
   * 按入口环境解析应用根目录，避免 GUI 和 CLI 分别猜测 resource 位置。
   */
  private resolve_app_root(): string {
    return resolve_app_root({
      appRoot: this.options.appRoot,
      env: process.env,
      platform: process.platform,
    });
  }

  /**
   * 启动公开 API Gateway，并返回 renderer/preload 可消费的本机地址。
   */
  private async start_gateway(backend_services: BackendServices): Promise<string> {
    const gateway_server = new ApiGatewayServer({
      backendServices: backend_services,
    });
    const gateway_start_result = await gateway_server.start();
    this.gateway_server = gateway_server;
    write_bootstrap_log(
      t_main_log("app.log.api_gateway_started", { BASE_URL: gateway_start_result.baseUrl }),
      this.log_manager ?? undefined,
    );
    write_bootstrap_log("", this.log_manager ?? undefined);
    return gateway_start_result.baseUrl;
  }

  /**
   * 启动期只解析一次系统代理，并把快照同时安装给主线程和后续 worker 线程。
   */
  private async install_system_proxy_snapshot(
    paths: AppPathService,
    app_setting_service: AppSettingService,
  ): Promise<void> {
    const resolver = this.options.systemProxyResolver;
    if (resolver === undefined) {
      this.system_proxy_snapshot = null;
      this.system_proxy_startup_notice = EMPTY_SYSTEM_PROXY_STARTUP_NOTICE;
      return;
    }
    const urls = collect_system_proxy_urls([
      ...read_config_model_preset_records(paths),
      ...read_config_model_records(app_setting_service.read_setting()),
    ]);
    this.system_proxy_dispatcher = await install_system_proxy_dispatcher({ resolver, urls });
    this.system_proxy_snapshot = this.system_proxy_dispatcher.snapshot;
    this.system_proxy_startup_notice = build_system_proxy_startup_notice(
      this.system_proxy_snapshot,
    );
    if (this.system_proxy_startup_notice.detected) {
      write_bootstrap_log(
        t_main_log("app.log.system_proxy_startup_detected", {
          PROXY: this.system_proxy_startup_notice.proxyDisplay ?? "",
        }),
        this.log_manager ?? undefined,
      );
    }
  }

  /**
   * Gateway、BackendServices、系统代理、ProjectDatabase 与日志必须逆序关闭，确保收尾阶段不丢日志。
   */
  private async stop_services(): Promise<void> {
    if (this.state === "stopped") {
      return;
    }
    this.state = "stopping";
    const errors: unknown[] = [];
    const attempt = async (dispose: () => void | Promise<void>): Promise<void> => {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    };

    const gateway_server = this.gateway_server;
    this.gateway_server = null;
    await attempt(async () => await gateway_server?.stop());

    const backend_services = this.backend_services;
    this.backend_services = null;
    await attempt(async () => await backend_services?.dispose());

    const system_proxy_dispatcher = this.system_proxy_dispatcher;
    this.system_proxy_dispatcher = null;
    this.system_proxy_snapshot = null;
    this.system_proxy_startup_notice = EMPTY_SYSTEM_PROXY_STARTUP_NOTICE;
    await attempt(async () => await system_proxy_dispatcher?.dispose());

    await attempt(() => this.database.close());

    const log_manager = this.log_manager;
    this.log_manager = null;
    await attempt(async () => await log_manager?.shutdown());
    set_main_log_language_reader(null);
    this.state = "stopped";
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close Backend resources.");
    }
  }
}
