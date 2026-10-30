import type { DatabaseSync } from "node:sqlite";
import type { JsonRecord } from "../../domain/json";
import type { ProjectAssetRecord, ProjectDatabase } from "../database/database-operations";

/** ID 是历史完成标记。列表顺序表达依赖，每项由调度入口独立提交。 */
export interface DatabaseWritebackMigration {
  readonly id: string;
  readonly run: (db: DatabaseSync) => void;
}

/** 打开期输入绑定单个工程。迁移只准备写入，由生命周期统一提交。 */
export interface ProjectOpenMigrationInput {
  readonly project_path: string;
  readonly database: ProjectDatabase;
}
/** 准备阶段共享只读快照。提交时按需要重新读取事务内事实。 */
export interface ProjectOpenMigrationContext extends ProjectOpenMigrationInput {
  readonly assets: readonly ProjectAssetRecord[];
  readonly meta: Readonly<JsonRecord>;
}
