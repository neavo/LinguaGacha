import { is_text_preserve_mode } from "../../../domain/quality";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { ProjectOpenMigrationContext } from "../migration-types";

/**
 * 迁移背景：
 * 旧工程使用 `text_preserve_enable` 布尔开关，且可能未持久化术语表启用值。
 * 当前任务只消费工程的 `text_preserve_mode` 和 `glossary_enable` 事实。
 *
 * 生效场景：
 * 工程打开时，缺失或非法 mode 按旧 bool 转换为 custom/smart。缺失术语表开关时补 true。
 * 写入按模式、术语表顺序交给生命周期事务，合法模式和显式开关使重复执行为空写。
 *
 * 不处理范围：
 * 保留旧 bool 和显式用户选择。规则内容、预设初始化及规则身份由各自入口负责。
 */
export function quality_settings_migration(
  context: ProjectOpenMigrationContext,
): ProjectDatabaseWrite[] {
  const { meta, project_path } = context;
  const writes: ProjectDatabaseWrite[] = [];
  if (!is_text_preserve_mode(meta["text_preserve_mode"])) {
    const mode = meta["text_preserve_enable"] === true ? "custom" : "smart";
    writes.push((database) => database.set_meta(project_path, "text_preserve_mode", mode));
  }
  if (!Object.hasOwn(meta, "glossary_enable")) {
    writes.push((database) => database.set_meta(project_path, "glossary_enable", true));
  }
  return writes;
}
