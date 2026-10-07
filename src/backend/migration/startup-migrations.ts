import type { StartupMigration, StartupMigrationContext } from "./migration-types";
import { legacy_default_config_migration } from "./startup/legacy-default-config-migration";
import { model_selection_migration } from "./startup/model-selection-migration";
import { prompt_user_preset_layout_migration } from "./startup/prompt-user-preset-layout-migration";
import { quality_rule_preset_layout_migration } from "./startup/quality-rule-preset-layout-migration";
import { user_skills_layout_migration } from "./startup/user-skills-layout-migration";

const STARTUP_MIGRATIONS: readonly StartupMigration[] = [
  legacy_default_config_migration,
  prompt_user_preset_layout_migration,
  quality_rule_preset_layout_migration,
  model_selection_migration,
  user_skills_layout_migration,
];

/** 设置首次读取前完成应用文件迁移。等待每项完成后再开始下一项。 */
export async function run_startup_migrations(context: StartupMigrationContext): Promise<void> {
  for (const migration of STARTUP_MIGRATIONS) {
    await migration(context);
  }
}
