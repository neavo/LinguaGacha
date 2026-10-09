import type { JsonValue } from "../../domain/json";
import type { ProjectDatabaseWrite } from "../database/database-operations";
import type { ProjectOpenMigration, ProjectOpenMigrationInput } from "./migration-types";
import { EpubRubyBlockTextMigration } from "./project/epub-ruby-block-text-migration";
import { MarkdownV2BlockMigration } from "./project/markdown-v2-block-migration";
import { quality_settings_migration } from "./project/quality-settings-migration";
import { translation_prompt_legacy_slot_migration } from "./project/translation-prompt-legacy-slot-migration";

const PROJECT_OPEN_MIGRATIONS: readonly ProjectOpenMigration[] = [
  quality_settings_migration,
  translation_prompt_legacy_slot_migration,
  (context) =>
    new EpubRubyBlockTextMigration(context.database).build_writes(
      context.project_path,
      context.items,
    ),
  (context) => new MarkdownV2BlockMigration().build_writes(context.project_path, context.items),
];

/** 准备阶段共享打开瞬间事实，所有写入仍由项目生命周期在同一事务提交。 */
export async function build_project_open_writes(
  input: ProjectOpenMigrationInput,
): Promise<ProjectDatabaseWrite[]> {
  const meta = input.database.get_all_meta(input.project_path);
  // 按原有首读时机延迟读取 Item。meta Case 失败时不会提前扫描条目。
  let items: readonly JsonValue[] | undefined;
  const context = {
    ...input,
    meta,
    get items() {
      if (items === undefined) {
        const value = input.database.get_all_items(input.project_path);
        items = value;
      }
      return items;
    },
  };
  const writes: ProjectDatabaseWrite[] = [];
  for (const migration of PROJECT_OPEN_MIGRATIONS) writes.push(...(await migration(context)));
  return writes;
}
