import type { DatabaseSync } from "node:sqlite";

import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import type { LogManager } from "../log/log-manager";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";

/**
 * startup hook 只服务应用启动期文件迁移，必须先于 AppSettingService 读取配置执行。
 */
export interface StartupMigrationContext {
  paths: AppPathService; // paths 是 appRoot/dataRoot/userdata/resource 的唯一权威，不允许迁移点自行猜根目录
  log_manager: LogManager; // log_manager 是启动期迁移失败的唯一诊断出口，失败不阻断 Backend 启动
}

/**
 * project database hook 只拿 SQLite 句柄，确保 `.lg` 物理迁移仍在 database workflow 内执行。
 */
export interface ProjectDatabaseMigrationContext {
  db: DatabaseSync; // db 已打开 WAL/NORMAL，并由 ProjectDatabase 负责连接生命周期
}

/**
 * project open hook 只生成 database operation，由 ProjectLifecycleService 放回同一事务提交。
 */
export interface ProjectOpenMigrationContext {
  project_path: string; // project_path 是本次 load_project 的唯一 .lg 目标，operation 不能跨工程
  database: ProjectDatabase; // database 只用于读取打开瞬间事实或读取 asset，不在 hook 内提交事务
  app_setting_service: AppSettingService; // app_setting_service 只提供当前应用设置，用于旧业务槽位的选择规则
}

/**
 * 单场景迁移描述符：同一个文件只实现自己需要的生命周期 hook。
 */
export interface MigrationDescriptor {
  readonly id: string; // id 是写回迁移持久标记，改名等同新增迁移，必须谨慎
  readonly order: number; // order 只表达同一 hook 内的依赖顺序，不承载业务优先级
  run_startup?(context: StartupMigrationContext): void; // startup hook 迁移应用级文件，失败诊断由迁移点记录
  run_project_database_schema?(context: ProjectDatabaseMigrationContext): void; // schema hook 只补物理结构，必须幂等
  run_project_database_writeback?(context: ProjectDatabaseMigrationContext): void; // writeback hook 写回业务事实，并由编排器按 id 标记
  build_project_open_operations?(
    context: ProjectOpenMigrationContext,
  ): Promise<DatabaseOperation[]> | DatabaseOperation[]; // open hook 只返回 operation，不直接提交事务
}
