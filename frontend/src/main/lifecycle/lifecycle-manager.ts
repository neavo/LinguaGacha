import { resolve_core_app_root } from "./lifecycle-command-resolver";
import { write_ts_lifecycle_log } from "./lifecycle-log";
import { build_core_api_base_url, allocate_core_api_port } from "./lifecycle-port-allocator";
import { DatabaseServer } from "../database/database-server";
import { ApiGatewayServer } from "../api/api-gateway-server";
import { AppPathService } from "../service/path-service";
import { LogManager } from "../log/log-manager";
import { set_electron_main_log_manager } from "../log/log-bridge";
import type {
  CoreLifecycleManagerOptions,
  CoreLifecycleStartResult,
  CoreLifecycleState,
  CoreProcessExitResult,
} from "./lifecycle-types";

const CORE_API_BASE_URL_ENV_NAME = "LINGUAGACHA_CORE_API_BASE_URL";

/**
 * Electron main 持有 TS Gateway、内部 Database Service 与日志系统的启动关闭顺序。
 */
export class CoreLifecycleManager {
  private state: CoreLifecycleState = "idle";
  private readonly options: CoreLifecycleManagerOptions;
  private gateway_server: ApiGatewayServer | null = null;
  private readonly database_server = new DatabaseServer();
  private log_manager: LogManager | null = null;

  /**
   * 生命周期管理器只接收宿主参数，端口、token 与服务句柄都由自身拥有。
   */
  public constructor(options: CoreLifecycleManagerOptions) {
    this.options = options;
  }

  /**
   * Electron 退出钩子只需要终态判断，避免重复进入 stop 收尾链路。
   */
  public isStopped(): boolean {
    return this.state === "idle" || this.state === "stopped" || this.state === "failed";
  }

  /**
   * 启动顺序固定为 LogManager -> Database Service -> TS Gateway。
   */
  public async start(): Promise<CoreLifecycleStartResult> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Core 生命周期状态不允许启动：${this.state}`);
    }

    this.state = "starting";
    const public_port = await allocate_core_api_port();
    const public_base_url = build_core_api_base_url(public_port);
    const launch_environment = {
      appRoot: this.options.appRoot,
      env: process.env,
      platform: process.platform,
    };
    const app_root = resolve_core_app_root(launch_environment);
    const paths = new AppPathService({ appRoot: app_root });
    const log_manager = new LogManager({ logDir: paths.get_log_dir() });
    this.log_manager = log_manager;
    set_electron_main_log_manager(log_manager);

    try {
      const database_start_result = await this.database_server.start();
      write_ts_lifecycle_log(`Database Service 已启动 - ${database_start_result.baseUrl}`);
      const gateway_server = new ApiGatewayServer({
        appRoot: app_root,
        publicPort: public_port,
        database: this.database_server.get_database(),
        logManager: log_manager,
      });
      const gateway_start_result = await gateway_server.start();
      this.gateway_server = gateway_server;
      write_ts_lifecycle_log(`TS Gateway 已启动 - ${gateway_start_result.baseUrl}`);
      process.env[CORE_API_BASE_URL_ENV_NAME] = public_base_url;
      this.state = "ready";
      return gateway_start_result;
    } catch (error) {
      write_ts_lifecycle_log(
        `Core / Gateway 启动失败 - ${error instanceof Error ? error.message : String(error)}`,
      );
      this.state = "failed";
      await this.stop_services();
      throw error;
    }
  }

  /**
   * 退出请求统一汇入 stop，避免窗口事件和 IPC 各自清理后端服务。
   */
  public async stop(): Promise<void> {
    await this.stop_services();
  }

  /**
   * 保留旧异常回调字段但不触发；TS-only 运行态没有伴生进程可意外退出。
   */
  public notifyUnexpectedExitForTest(result: CoreProcessExitResult): void {
    this.options.onUnexpectedExit?.(result);
  }

  /**
   * Gateway、Database 与日志必须逆序关闭，确保收尾阶段不丢日志。
   */
  private async stop_services(): Promise<void> {
    if (this.state === "stopping") {
      return;
    }
    this.state = "stopping";
    await this.gateway_server?.stop();
    this.gateway_server = null;
    await this.database_server.stop();
    await this.log_manager?.shutdown();
    this.log_manager = null;
    set_electron_main_log_manager(null);
    this.state = "stopped";
  }
}
