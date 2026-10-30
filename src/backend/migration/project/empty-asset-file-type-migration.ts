import path from "node:path";
import { XLSXFormat } from "../../file/xlsx/xlsx-format";
import { decode_text_content } from "../../../shared/utils/text-tool";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { ProjectOpenMigrationContext } from "../migration-types";

const MIGRATION_KEY = "migration.asset_file_type_complete";

/**
 * 迁移背景：
 * 无条目的历史 JSON 和 XLSX 缺少条目类型依据，数据库迁移后资产类型仍可能为 `NONE`。
 * 本迁移读取固化原稿，补齐 JSON 和工作簿的具体类型。
 *
 * 生效场景：
 * 工程打开且完成标记缺失时，检查类型为 `NONE` 的资产。
 * 识别结果与 `migration.asset_file_type_complete` 在打开事务中共同提交。
 *
 * 不处理范围：
 * 原稿缺失或内容无法识别时保留 `NONE`。迁移保留资产原始字节。
 * 完成标记记录已处理一次，不保证所有资产均已识别成功。
 */
export async function empty_asset_file_type_migration(
  context: ProjectOpenMigrationContext,
): Promise<ProjectDatabaseWrite[]> {
  if (context.meta[MIGRATION_KEY] === true) return [];
  const types = new Map<string, string>();
  for (const asset of context.assets) {
    if (asset.file_type !== "NONE") continue;
    const content = await context.database.read_asset_content(context.project_path, asset.path);
    if (content === null) continue;
    try {
      const extension = path.extname(asset.path).toLowerCase();
      if (extension === ".xlsx")
        types.set(asset.path, (await new XLSXFormat().read_asset(content, asset.path)).file_type);
      if (extension === ".json") {
        const value: unknown = JSON.parse(await decode_text_content(content));
        if (value !== null && typeof value === "object")
          types.set(asset.path, Array.isArray(value) ? "MESSAGEJSON" : "KVJSON");
      }
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
