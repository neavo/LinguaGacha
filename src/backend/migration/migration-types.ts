import type { DatabaseSync } from "node:sqlite";
import type { JsonRecord, JsonValue } from "../../domain/json";
import type { ProjectDatabase, ProjectDatabaseWrite } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";

/** 启动迁移在设置首次读取前升级应用文件，路径由应用服务提供。 */
export interface StartupMigrationContext {
  paths: AppPathService;
  log_manager: LogManager;
}
export type StartupMigration = (context: StartupMigrationContext) => void | Promise<void>;

/** ID 是历史完成标记。列表顺序表达依赖，每项由调度入口独立提交。 */
export interface DatabaseWritebackMigration {
  readonly id: string;
  readonly run: (db: DatabaseSync) => void;
}

/** 打开期输入绑定单个工程。迁移只准备写入，由生命周期统一提交。 */
export interface ProjectOpenMigrationInput {
  readonly project_path: string;
  readonly database: ProjectDatabase;
  readonly app_setting_service: AppSettingService;
}
/** 准备阶段共享只读快照。提交时按需要重新读取事务内事实。 */
export interface ProjectOpenMigrationContext extends ProjectOpenMigrationInput {
  readonly meta: Readonly<JsonRecord>;
  readonly items: readonly JsonValue[];
}
export type ProjectOpenMigration = (
  context: ProjectOpenMigrationContext,
) => Promise<ProjectDatabaseWrite[]> | ProjectDatabaseWrite[];
