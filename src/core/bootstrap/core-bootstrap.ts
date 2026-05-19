import { ApiGatewayServer } from "../api/api-gateway-server";
import { allocate_core_api_port } from "../api/api-port-allocator";
import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { set_electron_main_log_manager } from "../log/log-bridge";
import { set_main_log_language_reader, t_main_log } from "../log/log-text";
import { migration_orchestrator } from "../migration/migration-orchestrator";
import { InternalInvariantError } from "../../shared/error";
import { resolve_core_app_root } from "./core-app-root-resolver";
import { write_bootstrap_error, write_bootstrap_log } from "./bootstrap-log";
import { CoreServices } from "./core-services";
import type {
  CoreBootstrapOptions,
  CoreBootstrapStartResult,
  CoreBootstrapState,
} from "./core-bootstrap-types";

/**
 * CoreBootstrap 持有 Core 进程内资源的启动、服务组合和关闭顺序。
 */
export class CoreBootstrap {
  private state: CoreBootstrapState = "idle"; // state 防止启动、退出和异常收尾并发重入同一资源链路
  private readonly options: CoreBootstrapOptions; // options 来自 GUI/CLI 入口层，Bootstrap 只消费宿主注入事实
  private gateway_server: ApiGatewayServer | null = null; // gateway_server 只在 GUI 模式暴露 `/api/*`
  private core_services: CoreServices | null = null; // core_services 是 API Gateway 与 CLI job 的共享业务组合根
  private readonly database = new ProjectDatabase(); // database 直接承载 `.lg` 物理 workflow，由 Bootstrap 统一关闭
  private log_manager: LogManager | null = null; // log_manager 先于服务组合创建，确保启动失败和退出阶段都有统一日志出口

  /**
   * Bootstrap 只接收入口层参数，路径、端口和运行期资源句柄由自身拥有。
   */
  public constructor(options: CoreBootstrapOptions) {
    this.options = options;
  }

  /**
   * 入口退出钩子只需要终态判断，避免重复进入 stop 收尾链路。
   */
  public isStopped(): boolean {
    return this.state === "idle" || this.state === "stopped" || this.state === "failed";
  }

  /**
   * 启动顺序固定为 LogManager -> ProjectDatabase -> CoreServices -> 可选 API Gateway。
   */
  public async start(): Promise<CoreBootstrapStartResult> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new InternalInvariantError({
        diagnostic_context: {
          reason: "core_bootstrap_start_invalid_state",
          state: this.state,
        },
      });
    }

    this.state = "starting";
    const app_root = this.resolve_app_root();
    const paths = new AppPathService({ appRoot: app_root });
    const metadata = new AppMetadataService(paths);
    const log_manager = new LogManager({
      logDir: paths.get_log_dir(),
      targets: this.options.logTargets,
    });
    this.log_manager = log_manager;
    set_electron_main_log_manager(log_manager);

    try {
      write_bootstrap_log("");
      write_bootstrap_log(t_main_log("app.log.app_version", { VERSION: metadata.read_version() }));
      // 启动期迁移必须早于服务启动，确保配置和预设读取只看到当前 userdata/resource 布局。
      migration_orchestrator.run_startup_migrations({ paths, log_manager });
      const app_setting_service = new AppSettingService(paths);
      set_main_log_language_reader(() => app_setting_service.read_app_language());
      const core_services = new CoreServices({
        paths,
        metadata,
        appSettingService: app_setting_service,
        database: this.database,
        logManager: log_manager,
        openOutputFolder: this.options.openOutputFolder,
        workerExecution: this.options.workerExecution,
      });
      core_services.start();
      this.core_services = core_services;
      const api_base_url = this.options.exposeApiGateway
        ? await this.start_gateway(core_services)
        : null;
      this.state = "ready";
      // Electron shell 的系统 dialog 不能走 renderer i18n，因此只返回语言读取窄入口。
      return {
        apiBaseUrl: api_base_url,
        coreServices: core_services,
        readAppLanguage: () => app_setting_service.read_app_language(),
      };
    } catch (error) {
      write_bootstrap_error(
        t_main_log("app.diagnostic.lifecycle.core_gateway_start_failed", {
          ERROR: error instanceof Error ? error.message : String(error),
        }),
      );
      this.state = "failed";
      await this.stop_services();
      throw error;
    }
  }

  /**
   * 退出请求统一汇入 stop，避免 GUI 事件和 CLI job 各自清理 Core 资源。
   */
  public async stop(): Promise<void> {
    await this.stop_services();
  }

  /**
   * 按入口环境解析应用根目录，避免 GUI 和 CLI 分别猜测 resource 位置。
   */
  private resolve_app_root(): string {
    return resolve_core_app_root({
      appRoot: this.options.appRoot,
      env: process.env,
      platform: process.platform,
    });
  }

  /**
   * 启动公开 API Gateway，并返回 renderer/preload 可消费的本机地址。
   */
  private async start_gateway(core_services: CoreServices): Promise<string> {
    const public_port = await allocate_core_api_port();
    const gateway_server = new ApiGatewayServer({
      publicPort: public_port,
      coreServices: core_services,
    });
    const gateway_start_result = await gateway_server.start();
    this.gateway_server = gateway_server;
    write_bootstrap_log(
      t_main_log("app.log.api_gateway_started", { BASE_URL: gateway_start_result.baseUrl }),
    );
    write_bootstrap_log("");
    return gateway_start_result.baseUrl;
  }

  /**
   * Gateway、CoreServices、ProjectDatabase 与日志必须逆序关闭，确保收尾阶段不丢日志。
   */
  private async stop_services(): Promise<void> {
    if (this.state === "stopping") {
      return;
    }
    this.state = "stopping";
    await this.gateway_server?.stop();
    this.gateway_server = null;
    await this.core_services?.dispose();
    this.core_services = null;
    this.database.close();
    await this.log_manager?.shutdown();
    this.log_manager = null;
    set_electron_main_log_manager(null);
    set_main_log_language_reader(null);
    this.state = "stopped";
  }
}
