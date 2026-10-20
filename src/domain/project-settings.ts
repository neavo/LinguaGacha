import { AppError } from "../shared/error/app-error";
import { is_json_record, read_json_boolean, read_json_record, type JsonValue } from "./json";
import {
  normalize_source_language_code,
  normalize_target_language_code,
  type ConfiguredSourceLanguageCode,
  type TargetLanguageCode,
} from "./language";
import { DEFAULT_SETTING, normalize_setting_snapshot, type SettingSnapshot } from "./setting";

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

/** 两个开关属于应用设置；项目 meta 只记录最近一次预过滤采用的值。 */
export const APP_PREFILTER_SETTING_KEYS = [
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
] as const;
export type AppPrefilterSettingKey = (typeof APP_PREFILTER_SETTING_KEYS)[number];
export type AppPrefilterSettings = Readonly<Pick<SettingSnapshot, AppPrefilterSettingKey>>;

/** 预过滤计算输入，由项目语言和应用开关组合而成。 */
export type ProjectSettingsSnapshot = ProjectLanguageSettings & AppPrefilterSettings;

/** 单次执行使用的设置快照，组合值只属于本次执行。 */
export type ProjectExecutionSettings = SettingSnapshot & ProjectLanguageSettings;

/** 历史项目逐字段兜底：meta 优先，源语言再读旧 `prefilter_config`，最后使用默认值。 */
export function read_project_language_settings(meta: unknown): ProjectLanguageSettings {
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
  };
}

/** 读取项目记录的预过滤开关，meta 优先，缺失时回退旧 `prefilter_config` 与应用默认值。 */
export function read_project_prefilter_settings(meta: unknown): AppPrefilterSettings {
  const record = read_json_record(meta);
  const prefilter_config = read_json_record(record["prefilter_config"]);
  return {
    mtool_optimizer_enable: read_json_boolean(
      record["mtool_optimizer_enable"],
      read_json_boolean(
        prefilter_config["mtool_optimizer_enable"],
        DEFAULT_SETTING.mtool_optimizer_enable,
      ),
    ),
    skip_duplicate_source_text_enable: read_json_boolean(
      record["skip_duplicate_source_text_enable"],
      read_json_boolean(
        prefilter_config["skip_duplicate_source_text_enable"],
        DEFAULT_SETTING.skip_duplicate_source_text_enable,
      ),
    ),
  };
}

/** 从应用设置读取当前预过滤开关。 */
export function read_app_prefilter_settings(setting: unknown): AppPrefilterSettings {
  const snapshot = normalize_setting_snapshot(setting);
  return {
    mtool_optimizer_enable: snapshot.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: snapshot.skip_duplicate_source_text_enable,
  };
}

/** 请求边界的语言部分更新：未知字段、非字符串或不支持的语言直接拒绝。 */
export function parse_project_language_patch(value: unknown): Partial<ProjectLanguageSettings> {
  if (!is_json_record(value)) throw new AppError("request.validation_failed");
  const patch: { -readonly [K in ProjectLanguageKey]?: ProjectLanguageSettings[K] } = {};
  for (const [key, raw] of Object.entries(value)) {
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
