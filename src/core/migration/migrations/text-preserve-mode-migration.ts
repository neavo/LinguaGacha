import { is_text_preserve_mode } from "../../../base/quality";
import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

type MigrationMetaRecord = Record<string, DatabaseJsonValue>;

/**
 * 迁移背景：
 * 旧工程用 `text_preserve_enable` bool 表达文本保护开关。
 * 当前项目事实使用 `text_preserve_mode` 枚举，页面和任务链路不再读取旧 bool。
 *
 * 生效场景：
 * `load_project` 标记会话前构造同事务写回 operation；缺失或非法 mode 时按旧 bool 生成当前 mode。
 *
 * 不处理范围：
 * 质量规则内容和默认预设初始化不在本文件处理。
 */
export const text_preserve_mode_migration: MigrationDescriptor = {
  id: "text-preserve-mode",
  order: 600,
  /**
   * 只在 mode 缺失或非法时生成 setMeta operation，当前合法值不被旧 bool 覆盖。
   */
  build_project_open_operations(context: ProjectOpenMigrationContext): DatabaseOperation[] {
    const meta = get_all_meta(context);
    const raw_text_preserve_mode =
      typeof meta["text_preserve_mode"] === "string" ? meta["text_preserve_mode"] : "";
    if (is_text_preserve_mode(raw_text_preserve_mode)) {
      return [];
    }
    return [
      op("setMeta", {
        projectPath: context.project_path,
        key: "text_preserve_mode",
        value: meta["text_preserve_enable"] === true ? "custom" : "smart",
      }),
    ];
  },
};

/**
 * 读取打开瞬间 meta 快照，迁移决策不依赖后续事务内的临时状态。
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
