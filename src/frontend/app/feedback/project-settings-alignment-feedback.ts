import { normalize_language_code } from "@domain/language";
import { get_language_label_key } from "@frontend/app/locale/language-label";
import type { TextResolver } from "@shared/i18n";

type Translate = TextResolver;

export type ProjectSettingsAlignmentSettings = {
  source_language?: string; // 项目语言修改时展示新的源语言
  target_language?: string; // 项目语言修改时展示新的目标语言
  mtool_optimizer_enable?: boolean; // MTool 开关展示为已启用或已禁用
  skip_duplicate_source_text_enable?: boolean; // 重复原文开关展示为已启用或已禁用
};

export type ProjectSettingsAlignmentChangedFields = Partial<{
  source_language: boolean;
  target_language: boolean;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
}>;

/** 已知语言显示本地化名称，历史未知值保留原始代码以便识别。 */
function format_language_label(language: string, t: Translate): string {
  const normalized_language = language.trim().toUpperCase();
  const language_code = normalize_language_code(normalized_language);
  if (language_code === null) {
    return normalized_language;
  }

  const language_key = get_language_label_key(language_code);
  const language_label = t(language_key);
  if (language_label === language_key) {
    return normalized_language;
  }
  return language_label;
}

/** 按实际变化字段组合设置保存提示，供语言修改与预过滤开关对齐共用。 */
export function format_project_settings_aligned_toast(args: {
  settings: ProjectSettingsAlignmentSettings;
  changed_fields: ProjectSettingsAlignmentChangedFields;
  t: Translate;
}): string {
  const rows: string[] = [];

  if (args.changed_fields.source_language === true) {
    rows.push(
      args.t("app.tooltip.value", {
        TITLE: args.t("app.language_role.source"),
        VALUE: format_language_label(args.settings.source_language ?? "", args.t),
      }),
    );
  }

  if (args.changed_fields.target_language === true) {
    rows.push(
      args.t("app.tooltip.value", {
        TITLE: args.t("app.language_role.target"),
        VALUE: format_language_label(args.settings.target_language ?? "", args.t),
      }),
    );
  }

  if (args.changed_fields.mtool_optimizer_enable === true) {
    const mtool_label = args.settings.mtool_optimizer_enable
      ? args.t("app.state.enabled")
      : args.t("app.state.disabled");
    rows.push(
      args.t("app.tooltip.value", {
        TITLE: args.t("app.project_settings_alignment.field.mtool_optimizer_enable"),
        VALUE: mtool_label,
      }),
    );
  }

  if (args.changed_fields.skip_duplicate_source_text_enable === true) {
    const skip_duplicate_source_text_label = args.settings.skip_duplicate_source_text_enable
      ? args.t("app.state.enabled")
      : args.t("app.state.disabled");
    rows.push(
      args.t("app.tooltip.value", {
        TITLE: args.t("app.project_settings_alignment.field.skip_duplicate_source_text_enable"),
        VALUE: skip_duplicate_source_text_label,
      }),
    );
  }

  if (rows.length === 0) {
    return args.t("app.feedback.project_settings_aligned");
  }

  return [args.t("app.feedback.project_settings_aligned"), ...rows].join("\n");
}
