import JSZip from "jszip";
import { is_json_record } from "../../../domain/json";
import { is_game_file_type } from "../../../shared/project-source-formats";
import { GAME_ENGINES } from "../../file/shared/game/engines";
import { read_game_container } from "../../file/shared/game/format";
import { is_app_error } from "../../../shared/error";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { ProjectOpenMigrationContext } from "../migration-types";

/**
 * 已发布工程的附加原稿按历史清单一次性删除，完成后物理删除 `additional_files`。
 * 只准备写入，由打开事务统一提交。损坏资产保持原样，不阻止整个工程打开。
 */
export async function remove_additional_files_migration(
  context: ProjectOpenMigrationContext,
): Promise<ProjectDatabaseWrite[]> {
  if (!Object.hasOwn(context.meta, "additional_files")) return [];
  const manifest = context.meta["additional_files"];
  const writes: ProjectDatabaseWrite[] = [];
  if (is_json_record(manifest))
    for (const asset of context.assets) {
      const names = manifest[asset.path];
      if (
        !is_game_file_type(asset.file_type) ||
        !Array.isArray(names) ||
        !names.every((name) => typeof name === "string") ||
        !names.length
      )
        continue;
      try {
        const content = await context.database.read_asset_content(context.project_path, asset.path);
        if (content === null) continue;
        const zip = await JSZip.loadAsync(content);
        // 只删清单明确登记的确切名称，避免目录删除连带移除未登记成员。
        for (const name of names) delete zip.files[name];
        const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
        try {
          await read_game_container(
            bytes,
            asset.path,
            GAME_ENGINES[asset.file_type].create_adapter().has_metadata,
          );
          writes.push((database) =>
            database.update_asset(context.project_path, asset.path, bytes, asset.file_type, null),
          );
        } catch (error) {
          if (!is_app_error(error) || error.diagnostic_context?.reason !== "empty_game_container")
            throw error;
          writes.push((database) => database.delete_asset(context.project_path, asset.path));
        }
      } catch {
        // 已损坏或无法读取的历史资产保留原字节，不能让退场清理阻止打开。
      }
    }
  return [...writes, (database) => database.delete_meta(context.project_path, "additional_files")];
}
