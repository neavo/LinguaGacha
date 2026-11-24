import { AppError } from "../shared/error/app-error";
import { is_json_record, read_json_boolean, read_json_record, type JsonValue } from "./json";
import {
  normalize_source_language_code,
  normalize_target_language_code,
  type ConfiguredSourceLanguageCode,
  type TargetLanguageCode,
} from "./language";
import { normalize_setting_snapshot, type SettingSnapshot } from "./setting";

/** 项目语言保存在 `.lg` meta 中，项目是这两个字段的唯一事实来源。 */
export type ProjectLanguageSettings = Readonly<{
  source_language: ConfiguredSourceLanguageCode; // 允许 `ALL`，表示关闭源语言预过滤。
  target_language: TargetLanguageCode;
}>;
export type ProjectLanguageKey = keyof ProjectLanguageSettings;

export const DEFAULT_PROJECT_LANGUAGE_SETTINGS: ProjectLanguageSettings = Object.freeze({
  source_language: "JA",
  target_language: "ZH",
});

export const PROJECT_PREFILTER_SETTING_KEYS = [
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
] as const;
export type ProjectPrefilterSettingKey = (typeof PROJECT_PREFILTER_SETTING_KEYS)[number];
export type ProjectPrefilterSettings = Readonly<Record<ProjectPrefilterSettingKey, boolean>>;

/** 工程语言与预过滤开关共同保存在 `.lg` meta。 */
export type ProjectSettings = ProjectLanguageSettings & ProjectPrefilterSettings;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = Object.freeze({
  ...DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  mtool_optimizer_enable: true,
  skip_duplicate_source_text_enable: true,
});

/** 单次执行使用的设置快照，组合值只属于本次执行。 */
export type ProjectExecutionSettings = SettingSnapshot & ProjectLanguageSettings;

/** 执行快照和语言界面只消费设置中的两项语言。 */
export function read_project_language_settings(meta: unknown): ProjectLanguageSettings {
  const { source_language, target_language } = read_project_settings(meta);
  return { source_language, target_language };
}

/** 顶层 meta 是工程事实，旧 `prefilter_config` 只用于补齐历史文件缺失的字段。 */
export function read_project_settings(meta: unknown): ProjectSettings {
  const record = read_json_record(meta);
  const prefilter_config = read_json_record(record["prefilter_config"]);
  return {
    source_language:
      normalize_source_language_code(read_text(record["source_language"])) ??
      normalize_source_language_code(read_text(prefilter_config["source_language"])) ??
      DEFAULT_PROJECT_LANGUAGE_SETTINGS.source_language,
    target_language:
      normalize_target_language_code(read_text(record["target_language"])) ??
      DEFAULT_PROJECT_LANGUAGE_SETTINGS.target_language,
    mtool_optimizer_enable: read_json_boolean(
      record["mtool_optimizer_enable"],
      read_json_boolean(
        prefilter_config["mtool_optimizer_enable"],
        DEFAULT_PROJECT_SETTINGS.mtool_optimizer_enable,
      ),
    ),
    skip_duplicate_source_text_enable: read_json_boolean(
      record["skip_duplicate_source_text_enable"],
      read_json_boolean(
        prefilter_config["skip_duplicate_source_text_enable"],
        DEFAULT_PROJECT_SETTINGS.skip_duplicate_source_text_enable,
      ),
    ),
  };
}

/** 新建工程只允许指定初始语言。 */
export function parse_project_language_patch(value: unknown): Partial<ProjectLanguageSettings> {
  return parse_settings_patch(value, false);
}

/** 工程设置更新接受语言和严格的布尔开关，拒绝未知字段。 */
export function parse_project_settings_patch(value: unknown): Partial<ProjectSettings> {
  return parse_settings_patch(value, true);
}

function parse_settings_patch(value: unknown, allow_prefilter: boolean): Partial<ProjectSettings> {
  if (!is_json_record(value)) throw new AppError("request.validation_failed");
  const patch: Partial<ProjectSettings> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      allow_prefilter &&
      typeof raw === "boolean" &&
      PROJECT_PREFILTER_SETTING_KEYS.some((field) => field === key)
    ) {
      Object.assign(patch, { [key]: raw });
      continue;
    }
    const code =
      typeof raw !== "string"
        ? null
        : key === "source_language"
          ? normalize_source_language_code(raw)
          : key === "target_language"
            ? normalize_target_language_code(raw)
            : null;
    if (code === null) {
      throw new AppError("request.validation_failed", { public_details: { field: key } });
    }
    Object.assign(patch, { [key]: code });
  }
  return patch;
}

/** 运行租约内组合应用设置与项目语言，得到本轮执行快照。 */
export function build_project_execution_settings(
  setting: unknown,
  languages: ProjectLanguageSettings,
): ProjectExecutionSettings {
  return {
    ...normalize_setting_snapshot(setting),
    source_language: languages.source_language,
    target_language: languages.target_language,
  };
}

/** 历史字段只有字符串参与语言解析，其余值按缺失处理。 */
function read_text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}
