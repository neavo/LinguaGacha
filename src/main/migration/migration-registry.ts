import type { MigrationDescriptor } from "./migration-types";
import { analysis_checkpoint_status_migration } from "./migrations/analysis-checkpoint-status-migration";
import { epub_ruby_block_text_migration } from "./migrations/epub-ruby-block-text-migration";
import { legacy_default_config_migration } from "./migrations/legacy-default-config-migration";
import { project_item_stable_metadata_migration } from "./migrations/project-item-stable-metadata-migration";
import { project_item_public_contract_migration } from "./migrations/project-item-public-contract-migration";
import { project_rule_storage_migration } from "./migrations/project-rule-storage-migration";
import { project_schema_migration } from "./migrations/project-schema-migration";
import { prompt_user_preset_layout_migration } from "./migrations/prompt-user-preset-layout-migration";
import { quality_default_meta_migration } from "./migrations/quality-default-meta-migration";
import { quality_rule_preset_layout_migration } from "./migrations/quality-rule-preset-layout-migration";
import { text_preserve_mode_migration } from "./migrations/text-preserve-mode-migration";
import { trans_item_metadata_migration } from "./migrations/trans-item-metadata-migration";
import { translation_prompt_legacy_slot_migration } from "./migrations/translation-prompt-legacy-slot-migration";

/**
 * 全量迁移注册表按生命周期混排，真正执行顺序由编排器按 hook 和 order 二次筛选。
 */
export const MIGRATIONS: readonly MigrationDescriptor[] = [
  legacy_default_config_migration,
  prompt_user_preset_layout_migration,
  quality_rule_preset_layout_migration,
  project_schema_migration,
  project_rule_storage_migration,
  project_item_stable_metadata_migration,
  trans_item_metadata_migration,
  project_item_public_contract_migration,
  analysis_checkpoint_status_migration,
  text_preserve_mode_migration,
  quality_default_meta_migration,
  translation_prompt_legacy_slot_migration,
  epub_ruby_block_text_migration,
];

/**
 * 新建工程直接写入这组 id，表示它从出生起已经满足当前所有写回迁移契约。
 */
export const PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS = MIGRATIONS.filter(
  (migration) => migration.run_project_database_writeback !== undefined,
)
  .sort((left, right) => left.order - right.order)
  .map((migration) => migration.id);
