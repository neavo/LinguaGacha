import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { set_main_log_language_reader, t_main_log } from "../log/log-text";
import { migration_orchestrator } from "../migration/migration-orchestrator";
import {
  SystemProxyHttpClient,
  type SystemProxyResolver,
} from "../network/system-proxy-http-client";
import type { LogTargets } from "../../shared/log";
import { write_bootstrap_error, write_bootstrap_log } from "./bootstrap-log";

export interface BackendResourceOptions {
  appRoot: string; // 安装根与便携数据位置
  builtinRoot: string; // 当前版本只读内置资产根
  logTargets?: Partial<LogTargets>; // 入口按 GUI 或 CLI 选择日志出口
  systemProxyResolver: SystemProxyResolver; // Electron session 提供的系统代理事实
}

/**
 * 入口共享的基础资源生命周期；业务服务、Agent 与公开传输由各自组合根装配。
 */
export class BackendResources {
  private disposed = false;

  /** start 完成后一次性交付全部已初始化资源。 */
  private constructor(
    public readonly paths: AppPathService,
    public readonly metadata: AppMetadataService,
    public readonly settings: AppSettingService,
    public readonly database: ProjectDatabase,
    public readonly logManager: LogManager,
    private readonly system_proxy_http_client: SystemProxyHttpClient,
  ) {}

  /** 启动迁移、设置、日志、数据库与共享出站 HTTP transport。 */
  public static async start(options: BackendResourceOptions): Promise<BackendResources> {
    const paths = new AppPathService({
      appRoot: options.appRoot,
      builtinRoot: options.builtinRoot,
    });
    const metadata = new AppMetadataService(paths);
    const log_manager = new LogManager({
      logDir: paths.get_log_dir(),
      targets: options.logTargets,
    });
    const database = new ProjectDatabase();
    let system_proxy_http_client: SystemProxyHttpClient | null = null;

    try {
      write_bootstrap_log("", log_manager);
      write_bootstrap_log(
        t_main_log("app.log.app_version", { VERSION: metadata.read_version() }),
        log_manager,
      );
      migration_orchestrator.run_startup_migrations({ paths, log_manager });
      const settings = new AppSettingService(paths);
      set_main_log_language_reader(() => settings.read_app_language());
      system_proxy_http_client = new SystemProxyHttpClient(options.systemProxyResolver);
      system_proxy_http_client.install_as_global_fetch();
      return new BackendResources(
        paths,
        metadata,
        settings,
        database,
        log_manager,
        system_proxy_http_client,
      );
    } catch (error) {
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
      await collect_failure(failures, async () => await system_proxy_http_client?.dispose());
      await collect_failure(failures, () => database.close());
      await collect_failure(failures, async () => await log_manager.shutdown());
      set_main_log_language_reader(null);
      if (failures.length > 1) {
        throw new AggregateError(failures, "Backend resource startup and cleanup failed.");
      }
      throw error;
    }
  }

  /** 逆序释放共享 transport、数据库与日志；单项失败不跳过后续资源。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    await collect_failure(failures, async () => await this.system_proxy_http_client.dispose());
    await collect_failure(failures, () => this.database.close());
    await collect_failure(failures, async () => await this.logManager.shutdown());
    set_main_log_language_reader(null);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to close Backend resources.");
    }
  }
}

/** 生命周期清理收集全部失败，后续资源仍会继续释放。 */
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
