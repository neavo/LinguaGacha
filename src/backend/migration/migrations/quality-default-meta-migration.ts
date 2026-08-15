import type { JsonRecord } from "../../../domain/json";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

/**
 * 质量规则默认 meta 在打开期物化，后续组装和任务快照只消费当前工程事实。
 */
export const quality_default_meta_migration: MigrationDescriptor = {
  id: "quality-default-meta",
  order: 610,
  /**
   * 只物化历史缺失的术语表启用默认值，显式用户选择保持不变。
   */
  build_project_open_writes(context: ProjectOpenMigrationContext): ProjectDatabaseWrite[] {
    const meta = context.database.get_all_meta(context.project_path) as JsonRecord;
    if (Object.hasOwn(meta, "glossary_enable")) {
      return [];
    }
    return [(database) => database.set_meta(context.project_path, "glossary_enable", true)];
  },
};
