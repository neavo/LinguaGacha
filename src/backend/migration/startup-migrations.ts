import type { StartupMigration, StartupMigrationContext } from "./migration-types";
import { legacy_default_config_migration } from "./migrations/legacy-default-config-migration";
import { model_selection_migration } from "./migrations/model-selection-migration";
import { prompt_user_preset_layout_migration } from "./migrations/prompt-user-preset-layout-migration";
import { quality_rule_preset_layout_migration } from "./migrations/quality-rule-preset-layout-migration";
import { user_skills_layout_migration } from "./migrations/user-skills-layout-migration";

const STARTUP_MIGRATIONS: readonly StartupMigration[] = [
  legacy_default_config_migration,
  model_selection_migration,
  prompt_user_preset_layout_migration,
  quality_rule_preset_layout_migration,
  user_skills_layout_migration,
];

/** 设置首次读取前完成应用文件迁移；等待每项完成后再开始下一项。 */
export async function run_startup_migrations(
  context: StartupMigrationContext,
  migrations: readonly StartupMigration[] = STARTUP_MIGRATIONS,
): Promise<void> {
  for (const migration of migrations.toSorted((left, right) => left.order - right.order)) {
    await migration.run_startup(context);
  }
}
