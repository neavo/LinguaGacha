import { is_text_preserve_mode } from "../../../domain/quality";
import type { DatabaseJsonValue } from "../../database/database-types";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

type MigrationMetaRecord = Record<string, DatabaseJsonValue>;

/**
 * 迁移背景：
 * 旧工程用 `text_preserve_enable` bool 表达文本保护开关。
 * 当前项目事实使用 `text_preserve_mode` 枚举，页面和任务链路不再读取旧 bool。
 *
 * 生效场景：
 * `load_project` 标记会话前构造同事务类型化写入；缺失或非法 mode 时按旧 bool 生成当前 mode。
 *
 * 不处理范围：
 * 质量规则内容和默认预设初始化不在本文件处理。
 */
export const text_preserve_mode_migration: MigrationDescriptor = {
  id: "text-preserve-mode",
  order: 600,
  /**
   * 只在 mode 缺失或非法时生成 meta 写入，当前合法值不被旧 bool 覆盖。
   */
  build_project_open_writes(context: ProjectOpenMigrationContext): ProjectDatabaseWrite[] {
    const meta = context.database.get_all_meta(context.project_path) as MigrationMetaRecord;
    const raw_text_preserve_mode =
      typeof meta["text_preserve_mode"] === "string" ? meta["text_preserve_mode"] : "";
    if (is_text_preserve_mode(raw_text_preserve_mode)) {
      return [];
    }
    const mode = meta["text_preserve_enable"] === true ? "custom" : "smart";
    return [(database) => database.set_meta(context.project_path, "text_preserve_mode", mode)];
  },
};
