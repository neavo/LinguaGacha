import { resolve_core_app_root } from "./lifecycle-command-resolver";
import { write_lifecycle_log } from "./lifecycle-log";
import { allocate_core_api_port } from "./lifecycle-port-allocator";
import { ProjectDatabase } from "../database/database-operations";
import { ApiGatewayServer } from "../api/api-gateway-server";
import { UserDataMigrationService } from "../migration/user-data-migration-service";
import { AppPathService } from "../service/path-service";
import { LogManager } from "../log/log-manager";
import { set_electron_main_log_manager } from "../log/log-bridge";
import type {
  CoreLifecycleManagerOptions,
  CoreLifecycleStartResult,
  CoreLifecycleState,
  CoreProcessExitResult,
} from "./lifecycle-types";

/**
 * Electron main 持有 API Gateway、ProjectDatabase 与日志系统的启动关闭顺序。
 */
export class CoreLifecycleManager {
  // state 防止启动、退出和异常收尾并发重入同一生命周期链路。
  private state: CoreLifecycleState = "idle";
  // options 来自 Electron 入口层，生命周期层只消费宿主注入的不可变事实。
  private readonly options: CoreLifecycleManagerOptions;
  // gateway_server 是公开 `/api/*` 监听器，必须先于数据库句柄关闭。
  private gateway_server: ApiGatewayServer | null = null;
  // database 直接承载 `.lg` 物理 workflow；运行态不再创建内部 HTTP 回环服务。
  private readonly database = new ProjectDatabase();
  // log_manager 先于 Gateway 创建，确保启动失败和退出阶段都有统一日志出口。
  private log_manager: LogManager | null = null;

  /**
   * 生命周期管理器只接收宿主参数，端口与运行期资源句柄都由自身拥有。
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
   * 启动顺序固定为 LogManager -> ProjectDatabase -> API Gateway。
   */
  public async start(): Promise<CoreLifecycleStartResult> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Core 生命周期状态不允许启动：${this.state}`);
    }

    this.state = "starting";
    const public_port = await allocate_core_api_port();
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
      new UserDataMigrationService(paths, log_manager).run_startup_migrations();
      write_lifecycle_log("ProjectDatabase 已就绪");
      const gateway_server = new ApiGatewayServer({
        appRoot: app_root,
        publicPort: public_port,
        database: this.database,
        logManager: log_manager,
      });
      const gateway_start_result = await gateway_server.start();
      this.gateway_server = gateway_server;
      write_lifecycle_log(`API Gateway 已启动 - ${gateway_start_result.baseUrl}`);
      this.state = "ready";
      return gateway_start_result;
    } catch (error) {
      write_lifecycle_log(
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
   * 保留旧异常回调字段但不触发；当前运行态没有伴生进程可意外退出。
   */
  public notifyUnexpectedExitForTest(result: CoreProcessExitResult): void {
    this.options.onUnexpectedExit?.(result);
  }

  /**
   * Gateway、ProjectDatabase 与日志必须逆序关闭，确保收尾阶段不丢日志。
   */
  private async stop_services(): Promise<void> {
    if (this.state === "stopping") {
      return;
    }
    this.state = "stopping";
    await this.gateway_server?.stop();
    this.gateway_server = null;
    this.database.close();
    await this.log_manager?.shutdown();
    this.log_manager = null;
    set_electron_main_log_manager(null);
    this.state = "stopped";
  }
}
