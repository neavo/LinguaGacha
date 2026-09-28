import type { ProjectDatabaseWrite } from "../database/database-operations";
import type { ProjectOpenMigration, ProjectOpenMigrationContext } from "./migration-types";
import { epub_ruby_block_text_migration } from "./migrations/epub-ruby-block-text-migration";
import { markdown_v2_block_migration } from "./migrations/markdown-v2-block-migration";
import { quality_default_meta_migration } from "./migrations/quality-default-meta-migration";
import { text_preserve_mode_migration } from "./migrations/text-preserve-mode-migration";
import { translation_prompt_legacy_slot_migration } from "./migrations/translation-prompt-legacy-slot-migration";

const PROJECT_OPEN_MIGRATIONS: readonly ProjectOpenMigration[] = [
  epub_ruby_block_text_migration,
  markdown_v2_block_migration,
  quality_default_meta_migration,
  text_preserve_mode_migration,
  translation_prompt_legacy_slot_migration,
];

/** 只准备类型化写入，项目生命周期负责与其它打开期写入在同一事务提交。 */
export async function build_project_open_writes(
  context: ProjectOpenMigrationContext,
  migrations: readonly ProjectOpenMigration[] = PROJECT_OPEN_MIGRATIONS,
): Promise<ProjectDatabaseWrite[]> {
  const writes: ProjectDatabaseWrite[] = [];
  for (const migration of migrations.toSorted((left, right) => left.order - right.order)) {
    writes.push(...(await migration.build_project_open_writes(context)));
  }
  return writes;
}
