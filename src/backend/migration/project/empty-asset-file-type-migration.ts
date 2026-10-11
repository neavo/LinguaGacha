import path from "node:path";
import { XLSXFormat } from "../../file/xlsx/xlsx-format";
import { decode_text_content } from "../../../shared/utils/text-tool";
import type { ProjectOpenMigration } from "../migration-types";

const MIGRATION_KEY = "migration.asset_file_type_complete";

/** 无条目的历史 JSON / XLSX 需要读取固化原稿一次，完成标记与身份共同提交。 */
export const empty_asset_file_type_migration: ProjectOpenMigration = async (context) => {
  if (context.meta[MIGRATION_KEY] === true) return [];
  const types = new Map<string, string>();
  for (const asset of context.assets) {
    if (asset.file_type !== "NONE") continue;
    const content = context.database.read_asset_content(context.project_path, asset.path);
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
};
