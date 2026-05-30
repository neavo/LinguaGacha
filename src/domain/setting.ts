import type { JsonValue } from "../shared/utils/json-tool";

export {
  ALL_LANGUAGE_CODE,
  CJK_LANGUAGE_CODES,
  LANGUAGE_CODES,
  LANGUAGE_DEFINITIONS,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  all_language_characters,
  get_language_display_locale,
  get_language_display_name,
  get_language_label_key,
  get_prompt_source_language_name,
  get_prompt_target_language_name,
  has_language_character,
  is_language_character,
  normalize_language_code,
  strip_non_language_characters,
  type LanguageDisplayLocale,
  type LanguageLabelKey,
  type LanguageCode,
  type SourceLanguageCode,
  type TargetLanguageCode,
} from "./language";

/**
 * 集中维护当前模块的稳定常量。
 */
export const APP_LANGUAGES = ["ZH", "EN"] as const; // AppLanguage 是设置文件、运行态 settings 和 i18n locale 计算的唯一语言值域

/**
 * 集中维护当前模块的稳定常量。
 */
export const APP_LOCALES = ["zh-CN", "en-US"] as const; // AppLocale 只服务渲染进程国际化，不替代设置快照中的应用语言

/**
 * 集中维护当前模块的稳定常量。
 */
export const PROJECT_SAVE_MODES = ["MANUAL", "FIXED", "SOURCE"] as const; // ProjectSaveMode 是项目保存位置策略，页面和设置服务都从这里取合法值

export type AppLanguage = (typeof APP_LANGUAGES)[number];
export type AppLocale = (typeof APP_LOCALES)[number];
export type ProjectSaveMode = (typeof PROJECT_SAVE_MODES)[number];
type SettingJsonRecord = Record<string, JsonValue>;

export type RecentProjectSetting = {
  path: string; // 最近工程路径
  name: string; // 最近工程展示名
  updated_at: string; // 最近工程更新时间
};

export type SettingSnapshot = {
  app_language: AppLanguage; // 渲染进程国际化与日志文案共同消费的应用语言
  source_language: string; // 源语言允许 ALL，具体过滤器负责进一步收窄
  target_language: string; // 目标语言进入提示词和项目设置镜像
  project_save_mode: ProjectSaveMode;
  project_fixed_path: string;
  output_folder_open_on_finish: boolean;
  request_timeout: number;
  preceding_lines_threshold: number;
  clean_ruby: boolean;
  deduplication_in_bilingual: boolean;
  check_kana_residue: boolean;
  check_hangeul_residue: boolean;
  check_similarity: boolean;
  write_translated_name_fields_to_file: boolean;
  auto_process_prefix_suffix_preserved_text: boolean;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
  glossary_default_preset: string;
  text_preserve_default_preset: string;
  pre_translation_replacement_default_preset: string;
  post_translation_replacement_default_preset: string;
  translation_custom_prompt_default_preset: string;
  analysis_custom_prompt_default_preset: string;
  recent_projects: RecentProjectSetting[];
};

export type ProjectSettingsSnapshot = Pick<
  SettingSnapshot,
  | "source_language"
  | "target_language"
  | "mtool_optimizer_enable"
  | "skip_duplicate_source_text_enable"
>;

/**
 * 集中维护当前模块的稳定常量。
 */
export const SETTING_KEYS = [
  "app_language",
  "source_language",
  "target_language",
  "project_save_mode",
  "project_fixed_path",
  "output_folder_open_on_finish",
  "request_timeout",
  "preceding_lines_threshold",
  "clean_ruby",
  "deduplication_in_bilingual",
  "check_kana_residue",
  "check_hangeul_residue",
  "check_similarity",
  "write_translated_name_fields_to_file",
  "auto_process_prefix_suffix_preserved_text",
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
  "glossary_default_preset",
  "text_preserve_default_preset",
  "pre_translation_replacement_default_preset",
  "post_translation_replacement_default_preset",
  "translation_custom_prompt_default_preset",
  "analysis_custom_prompt_default_preset",
  "recent_projects",
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

const BOOLEAN_SETTING_KEYS = new Set([
  "output_folder_open_on_finish",
  "clean_ruby",
  "deduplication_in_bilingual",
  "check_kana_residue",
  "check_hangeul_residue",
  "check_similarity",
  "write_translated_name_fields_to_file",
  "auto_process_prefix_suffix_preserved_text",
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
]);

const NUMBER_SETTING_KEYS = new Set(["request_timeout", "preceding_lines_threshold"]);

/**
 * 集中维护当前模块的稳定常量。
 */
export const DEFAULT_SETTING: SettingJsonRecord = {
  app_language: "ZH",
  source_language: "JA",
  target_language: "ZH",
  project_save_mode: "MANUAL",
  project_fixed_path: "",
  output_folder_open_on_finish: false,
  request_timeout: 120,
  preceding_lines_threshold: 0,
  clean_ruby: false,
  deduplication_in_bilingual: true,
  check_kana_residue: true,
  check_hangeul_residue: true,
  check_similarity: true,
  write_translated_name_fields_to_file: true,
  auto_process_prefix_suffix_preserved_text: true,
  mtool_optimizer_enable: true,
  skip_duplicate_source_text_enable: true,
  glossary_default_preset: "",
  text_preserve_default_preset: "",
  pre_translation_replacement_default_preset: "",
  post_translation_replacement_default_preset: "",
  translation_custom_prompt_default_preset: "",
  analysis_custom_prompt_default_preset: "",
  recent_projects: [],
  activate_model_id: "",
  models: null,
};

const APP_LANGUAGE_SET = new Set<AppLanguage>(APP_LANGUAGES);
const PROJECT_SAVE_MODE_SET = new Set<ProjectSaveMode>(PROJECT_SAVE_MODES);

/**
 * Setting 是 userdata/config.json 的业务实体；文件名保留 config.json，但领域语义统一为设置
 */
export class Setting {
  public readonly data: SettingJsonRecord; // 完整设置文件形状；设置快照只从白名单计算

  /**
   * 初始化当前实例的内部状态。
   */
  private constructor(data: SettingJsonRecord) {
    this.data = data;
  }

  /**
   * 从 userdata 设置文件或页面 payload 反序列化，并只保留当前已知设置字段
   */
  public static from_json(payload: unknown): Setting {
    const setting = { ...DEFAULT_SETTING };
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      for (const [key, value] of Object.entries(payload as SettingJsonRecord)) {
        if (key in DEFAULT_SETTING) {
          setting[key] = Setting.normalize_value(key, value);
        }
      }
    }
    return new Setting(setting);
  }

  /**
   * 输出完整设置文件形状，模型配置等非设置快照字段仍保留在同一落盘对象内
   */
  public to_json(): SettingJsonRecord {
    return { ...this.data };
  }

  /**
   * 构建渲染进程可见设置快照，隔离 config.json 历史内部形状
   */
  public to_snapshot(): SettingSnapshot {
    return normalize_setting_snapshot(this.data);
  }

  /**
   * 更新单个白名单设置字段，未知 key 不改变设置文件
   */
  public with_setting_value(key: string, value: JsonValue): Setting {
    if (!SETTING_KEYS.includes(key as SettingKey)) {
      return this;
    }
    return new Setting({
      ...this.data,
      [key]: Setting.normalize_value(key, value),
    });
  }

  /**
   * 追加最近项目时集中处理去重、截断、展示名和本地时间戳
   */
  public with_recent_project_added(project_path: string, timestamp: string): Setting {
    if (project_path === "") {
      return this;
    }
    const filtered_items = this.read_recent_projects().filter((item) => item.path !== project_path);
    filtered_items.unshift({
      path: project_path,
      name: Setting.build_recent_project_display_name(project_path),
      updated_at: timestamp,
    });
    return new Setting({
      ...this.data,
      recent_projects: filtered_items.slice(0, 10) as unknown as JsonValue,
    });
  }

  /**
   * 移除最近项目时保持列表项结构稳定，避免页面收到坏对象
   */
  public with_recent_project_removed(project_path: string): Setting {
    return new Setting({
      ...this.data,
      recent_projects: this.read_recent_projects().filter(
        (item) => item.path !== project_path,
      ) as unknown as JsonValue,
    });
  }

  /**
   * 读取最近项目列表，兼容旧设置中的缺失字段
   */
  public read_recent_projects(): RecentProjectSetting[] {
    const raw_items = this.data["recent_projects"];
    if (!Array.isArray(raw_items)) {
      return [];
    }
    return raw_items
      .filter((item): item is SettingJsonRecord => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({
        path: typeof item["path"] === "string" ? item["path"] : "",
        name: typeof item["name"] === "string" ? item["name"] : "",
        updated_at: typeof item["updated_at"] === "string" ? item["updated_at"] : "",
      }))
      .filter((item) => item.path !== "");
  }

  /**
   * 归一设置字段，防止未知类型写入设置文件
   */
  public static normalize_value(key: string, value: JsonValue): JsonValue {
    if (key === "app_language") {
      return Setting.normalize_app_language(value);
    }
    if (key === "project_save_mode") {
      return Setting.normalize_project_save_mode(value);
    }
    if (key === "recent_projects") {
      return normalize_recent_project_settings(value) as unknown as JsonValue;
    }
    if (BOOLEAN_SETTING_KEYS.has(key)) {
      return normalize_boolean_setting(value, Boolean(DEFAULT_SETTING[key]));
    }
    if (NUMBER_SETTING_KEYS.has(key)) {
      return normalize_number_setting(value, Number(DEFAULT_SETTING[key] ?? 0));
    }
    if (key in DEFAULT_SETTING && key !== "models") {
      return String(value ?? DEFAULT_SETTING[key] ?? "");
    }
    return value;
  }

  /**
   * app_language 兼容大小写输入，未知值回退中文界面
   */
  public static normalize_app_language(value: unknown): AppLanguage {
    const language = String(value ?? "")
      .trim()
      .toUpperCase();
    return is_app_language(language) ? language : "ZH";
  }

  /**
   * i18n locale 是 app_language 的计算结果，不单独持久化为第二状态源
   */
  public static resolve_app_locale(app_language: AppLanguage): AppLocale {
    return app_language === "EN" ? "en-US" : "zh-CN";
  }

  /**
   * 缺失或未知保存模式按历史手动保存策略处理
   */
  public static normalize_project_save_mode(value: unknown): ProjectSaveMode {
    return is_project_save_mode(value) ? value : "MANUAL";
  }

  /**
   * 构建当前场景的稳定结果。
   */
  private static build_recent_project_display_name(project_path: string): string {
    const base = project_path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
    const dot_index = base.lastIndexOf(".");
    return dot_index > 0 ? base.slice(0, dot_index) : base;
  }
}

// 设置文件和设置页 payload 统一通过这里确认语言值域
/**
 * 判断当前值是否满足业务条件。
 */
export function is_app_language(value: unknown): value is AppLanguage {
  return APP_LANGUAGE_SET.has(value as AppLanguage);
}

// 项目保存模式写入设置前先确认合法值，避免页面草稿值落盘
/**
 * 判断当前值是否满足业务条件。
 */
export function is_project_save_mode(value: unknown): value is ProjectSaveMode {
  return PROJECT_SAVE_MODE_SET.has(value as ProjectSaveMode);
}

/**
 * 渲染进程、主进程和 worker 的设置快照只从这一处补默认值和收窄类型
 */
export function normalize_setting_snapshot(value: unknown): SettingSnapshot {
  const record = read_setting_record(value);
  return {
    app_language: Setting.normalize_app_language(record["app_language"]),
    source_language: read_string_setting(record["source_language"], "source_language"),
    target_language: read_string_setting(record["target_language"], "target_language"),
    project_save_mode: Setting.normalize_project_save_mode(record["project_save_mode"]),
    project_fixed_path: read_string_setting(record["project_fixed_path"], "project_fixed_path", {
      preserve_case: true,
    }),
    output_folder_open_on_finish: read_boolean_setting(
      record["output_folder_open_on_finish"],
      "output_folder_open_on_finish",
    ),
    request_timeout: read_number_setting(record["request_timeout"], "request_timeout"),
    preceding_lines_threshold: read_number_setting(
      record["preceding_lines_threshold"],
      "preceding_lines_threshold",
    ),
    clean_ruby: read_boolean_setting(record["clean_ruby"], "clean_ruby"),
    deduplication_in_bilingual: read_boolean_setting(
      record["deduplication_in_bilingual"],
      "deduplication_in_bilingual",
    ),
    check_kana_residue: read_boolean_setting(record["check_kana_residue"], "check_kana_residue"),
    check_hangeul_residue: read_boolean_setting(
      record["check_hangeul_residue"],
      "check_hangeul_residue",
    ),
    check_similarity: read_boolean_setting(record["check_similarity"], "check_similarity"),
    write_translated_name_fields_to_file: read_boolean_setting(
      record["write_translated_name_fields_to_file"],
      "write_translated_name_fields_to_file",
    ),
    auto_process_prefix_suffix_preserved_text: read_boolean_setting(
      record["auto_process_prefix_suffix_preserved_text"],
      "auto_process_prefix_suffix_preserved_text",
    ),
    mtool_optimizer_enable: read_boolean_setting(
      record["mtool_optimizer_enable"],
      "mtool_optimizer_enable",
    ),
    skip_duplicate_source_text_enable: read_boolean_setting(
      record["skip_duplicate_source_text_enable"],
      "skip_duplicate_source_text_enable",
    ),
    glossary_default_preset: read_string_setting(
      record["glossary_default_preset"],
      "glossary_default_preset",
      { preserve_case: true },
    ),
    text_preserve_default_preset: read_string_setting(
      record["text_preserve_default_preset"],
      "text_preserve_default_preset",
      { preserve_case: true },
    ),
    pre_translation_replacement_default_preset: read_string_setting(
      record["pre_translation_replacement_default_preset"],
      "pre_translation_replacement_default_preset",
      { preserve_case: true },
    ),
    post_translation_replacement_default_preset: read_string_setting(
      record["post_translation_replacement_default_preset"],
      "post_translation_replacement_default_preset",
      { preserve_case: true },
    ),
    translation_custom_prompt_default_preset: read_string_setting(
      record["translation_custom_prompt_default_preset"],
      "translation_custom_prompt_default_preset",
      { preserve_case: true },
    ),
    analysis_custom_prompt_default_preset: read_string_setting(
      record["analysis_custom_prompt_default_preset"],
      "analysis_custom_prompt_default_preset",
      { preserve_case: true },
    ),
    recent_projects: normalize_recent_project_settings(record["recent_projects"]),
  };
}

/**
 * 项目设置镜像只保留会影响预过滤、提示词和目标语言展示的窄字段
 */
export function normalize_project_settings_snapshot(
  value: unknown,
  fallback: ProjectSettingsSnapshot = {
    source_language: String(DEFAULT_SETTING["source_language"]),
    target_language: String(DEFAULT_SETTING["target_language"]),
    mtool_optimizer_enable: Boolean(DEFAULT_SETTING["mtool_optimizer_enable"]),
    skip_duplicate_source_text_enable: Boolean(
      DEFAULT_SETTING["skip_duplicate_source_text_enable"],
    ),
  },
): ProjectSettingsSnapshot {
  const record = read_setting_record(value);
  return {
    source_language: read_project_string_setting(
      record["source_language"],
      fallback.source_language,
    ),
    target_language: read_project_string_setting(
      record["target_language"],
      fallback.target_language,
    ),
    mtool_optimizer_enable: normalize_boolean_setting(
      record["mtool_optimizer_enable"],
      fallback.mtool_optimizer_enable,
    ),
    skip_duplicate_source_text_enable: normalize_boolean_setting(
      record["skip_duplicate_source_text_enable"],
      fallback.skip_duplicate_source_text_enable,
    ),
  };
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_setting_record(value: unknown): SettingJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as SettingJsonRecord)
    : {};
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_string_setting(
  value: JsonValue | undefined,
  key: SettingKey,
  options: { preserve_case?: boolean } = {},
): string {
  const fallback = String(DEFAULT_SETTING[key] ?? "");
  const raw_value = String(value ?? fallback).trim();
  return options.preserve_case === true ? raw_value : raw_value.toUpperCase();
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_project_string_setting(value: JsonValue | undefined, fallback: string): string {
  const text = String(value ?? "").trim();
  return text === "" ? fallback : text.toUpperCase();
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_boolean_setting(value: JsonValue | undefined, key: SettingKey): boolean {
  return normalize_boolean_setting(value, Boolean(DEFAULT_SETTING[key]));
}

/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_boolean_setting(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return fallback;
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_number_setting(value: JsonValue | undefined, key: SettingKey): number {
  return normalize_number_setting(value, Number(DEFAULT_SETTING[key] ?? 0));
}

/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_number_setting(value: unknown, fallback: number): number {
  const number_value = Number(value ?? fallback);
  return Number.isFinite(number_value) ? number_value : fallback;
}

/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_recent_project_settings(value: unknown): RecentProjectSetting[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is SettingJsonRecord => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    })
    .map((item) => ({
      path: String(item["path"] ?? "").trim(),
      name: String(item["name"] ?? "").trim(),
      updated_at: String(item["updated_at"] ?? "").trim(),
    }))
    .filter((item) => item.path !== "");
}

/**
 * 集中维护当前模块的稳定常量。
 */
export const normalize_app_language = Setting.normalize_app_language;
/**
 * 集中维护当前模块的稳定常量。
 */
export const resolve_app_locale = Setting.resolve_app_locale;
/**
 * 集中维护当前模块的稳定常量。
 */
export const normalize_project_save_mode = Setting.normalize_project_save_mode;
