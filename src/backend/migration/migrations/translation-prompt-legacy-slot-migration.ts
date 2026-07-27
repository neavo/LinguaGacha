import { resolve_prompt_template_language } from "../../../domain/app-language";
import type { JsonRecord } from "../../../domain/json";
import type { ProjectDatabaseWrite } from "../../database/database-operations";
import type { MigrationDescriptor, ProjectOpenMigrationContext } from "../migration-types";

// 旧语言槽位、当前统一槽位和一次性完成标记都写在这里，避免跨文件隐藏迁移契约。
const LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE = "CUSTOM_PROMPT_ZH";
const LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE = "CUSTOM_PROMPT_EN";
const LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY = "translation_prompt_legacy_migrated";
const TRANSLATION_PROMPT_RULE_TYPE = "translation_prompt";

/**
 * 迁移背景：
 * 旧工程把翻译提示词按界面语言拆到 `CUSTOM_PROMPT_ZH` / `CUSTOM_PROMPT_EN`。
 * 当前工程只暴露单一 `translation_prompt` 物理槽位。
 *
 * 生效场景：
 * `load_project` 打开旧工程且迁移标记缺失时，若当前槽位为空，则按当前应用语言优先读取旧槽位写回。
 * 无论旧槽位是否有内容，都会写入完成标记，避免用户清空当前提示词后被旧残留反复覆盖。
 *
 * 不处理范围：
 * rules 表旧大写类型和文本 payload 形状已在数据库写回迁移中归一；本文件只处理跨槽位业务语义。
 */
export const translation_prompt_legacy_slot_migration: MigrationDescriptor = {
  id: "translation-prompt-legacy-slot",
  order: 700,
  /**
   * 当前提示词优先；仅在当前槽位为空且未迁移时从旧语言槽位补写一次。
   */
  build_project_open_writes(context: ProjectOpenMigrationContext): ProjectDatabaseWrite[] {
    const meta = context.database.get_all_meta(context.project_path) as JsonRecord;
    if (meta[LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY] === true) {
      return [];
    }

    const writes: ProjectDatabaseWrite[] = [];
    const current_prompt = context.database
      .get_rule_text(context.project_path, TRANSLATION_PROMPT_RULE_TYPE)
      .trim();
    const legacy_prompt = current_prompt === "" ? get_legacy_translation_prompt(context) : "";
    if (legacy_prompt !== "") {
      writes.push((database) =>
        database.set_rule_text(context.project_path, TRANSLATION_PROMPT_RULE_TYPE, legacy_prompt),
      );
    }
    writes.push((database) =>
      database.set_meta(context.project_path, LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY, true),
    );
    return writes;
  },
};

/**
 * 按当前应用语言决定旧 ZH/EN 槽位优先级，保持旧版本用户界面选择语义。
 */
function get_legacy_translation_prompt(context: ProjectOpenMigrationContext): string {
  const config = context.app_setting_service.read_setting();
  const preferred_rule_types =
    resolve_prompt_template_language(config["app_language"]) === "en"
      ? [LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE, LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE]
      : [LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE, LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE];
  for (const rule_type of preferred_rule_types) {
    const candidate = context.database.get_rule_text(context.project_path, rule_type).trim();
    if (candidate !== "") {
      return candidate;
    }
  }
  return "";
}
