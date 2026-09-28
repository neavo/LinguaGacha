import type { DatabaseSync } from "node:sqlite";

import type { ProjectDatabase, ProjectDatabaseWrite } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";

/**
 * 启动迁移在 `AppSettingService` 首次读取配置前升级应用文件。
 */
export interface StartupMigrationContext {
  paths: AppPathService; // appRoot/builtinRoot/dataRoot/userdata 的唯一权威，不允许迁移点自行猜根目录
  log_manager: LogManager; // 记录可继续启动的迁移诊断，组合根负责处理抛出的异常
}

/**
 * 数据库迁移使用 SQLite 句柄，在连接就绪前升级 `.lg`。
 */
export interface ProjectDatabaseMigrationContext {
  db: DatabaseSync; // 已打开 WAL/NORMAL，并由 ProjectDatabase 负责连接生命周期
}

/**
 * 工程打开迁移准备类型化写入，由 `ProjectLifecycleService` 在同一事务提交。
 */
export interface ProjectOpenMigrationContext {
  project_path: string; // 本次 load_project 的唯一 .lg 目标，类型化写入不能跨工程
  database: ProjectDatabase; // 只用于读取打开瞬间事实或读取 asset，不在 hook 内提交事务
  app_setting_service: AppSettingService; // 只提供当前应用设置，用于旧业务槽位的选择规则
}

/** 标识属于持久化契约，顺序只表达同一生命周期内的依赖。 */
interface MigrationIdentity {
  readonly id: string; // 数据库写回使用的持久标记。
  readonly order: number; // 同一阶段内的执行顺序。
}
export interface StartupMigration extends MigrationIdentity {
  run_startup(context: StartupMigrationContext): void | Promise<void>;
}
export interface DatabaseSchemaMigration extends MigrationIdentity {
  run_project_database_schema(context: ProjectDatabaseMigrationContext): void;
}
export interface DatabaseWritebackMigration extends MigrationIdentity {
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void;
}
export interface ProjectOpenMigration extends MigrationIdentity {
  build_project_open_writes(
    context: ProjectOpenMigrationContext,
  ): Promise<ProjectDatabaseWrite[]> | ProjectDatabaseWrite[];
}
