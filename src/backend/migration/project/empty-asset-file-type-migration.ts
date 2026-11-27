import path from "node:path";
import { decode_text_content } from "../../../shared/utils/text-tool";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { ProjectOpenMigrationContext } from "../migration-types";

const MIGRATION_KEY = "migration.asset_file_type_complete";

/**
 * 迁移背景：
 * 没有条目的旧 JSON 资产缺少用于判定格式的条目记录，资产类型可能仍为 `NONE`。
 *
 * 生效场景：
 * 打开工程且完成标记缺失时，从 `NONE` 类型的 JSON 原稿补齐格式，并在同一事务标记扫描完成。
 *
 * 不处理范围：
 * 原稿缺失或类型无法判定时保留原有资产。完成标记只记录已扫描。
 */
export async function empty_asset_file_type_migration(
  context: ProjectOpenMigrationContext,
): Promise<ProjectDatabaseWrite[]> {
  if (context.meta[MIGRATION_KEY] === true) return [];
  const types = new Map<string, string>();
  for (const asset of context.assets) {
    if (asset.file_type !== "NONE" || path.extname(asset.path).toLowerCase() !== ".json") continue;
    const content = await context.database.read_asset_content(context.project_path, asset.path);
    if (content === null) continue;
    try {
      const value: unknown = JSON.parse(await decode_text_content(content));
      if (value !== null && typeof value === "object")
        types.set(asset.path, Array.isArray(value) ? "MESSAGEJSON" : "KVJSON");
    } catch {
      // 无法识别的历史资产保留 NONE 和原始字节，不能猜测写回格式。
    }
  }
  return [
    (database) => {
      for (const [file, type] of types)
        database.set_asset_file_type(context.project_path, file, type);
      database.set_meta(context.project_path, MIGRATION_KEY, true);
    },
  ];
}
