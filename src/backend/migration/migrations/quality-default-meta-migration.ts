import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

type MigrationMetaRecord = Record<string, DatabaseJsonValue>;

/**
 * 质量规则默认 meta 在打开期物化，后续组装和任务快照只消费当前工程事实。
 */
export const quality_default_meta_migration: MigrationDescriptor = {
  id: "quality-default-meta",
  order: 610,
  build_project_open_operations(context: ProjectOpenMigrationContext): DatabaseOperation[] {
    const meta = get_all_meta(context);
    if (Object.prototype.hasOwnProperty.call(meta, "glossary_enable")) {
      return [];
    }
    return [
      op("setMeta", {
        projectPath: context.project_path,
        key: "glossary_enable",
        value: true,
      }),
    ];
  },
};

/**
 * 读取打开瞬间 meta 快照，避免迁移决策依赖尚未提交的同批 operation。
 */
function get_all_meta(context: ProjectOpenMigrationContext): MigrationMetaRecord {
  return context.database.execute({
    name: "getAllMeta",
    args: { projectPath: context.project_path },
  }) as MigrationMetaRecord;
}

/**
 * project open hook 只返回受限 database operation，不直接提交数据库。
 */
function op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
  return { name, args };
}
