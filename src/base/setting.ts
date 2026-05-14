import type { JsonValue } from "../shared/utils/json-tool";

export {
  ALL_LANGUAGE_CODE,
  CJK_LANGUAGE_CODES,
  LANGUAGE_DEFINITIONS,
  SOURCE_TARGET_LANGUAGE_CODES,
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
  type SourceTargetLanguageCode,
} from "../shared/language";

export const APP_LANGUAGES = ["ZH", "EN"] as const; // AppLanguage 是设置文件、运行态 settings 和 i18n locale 派生的唯一语言值域

export const APP_LOCALES = ["zh-CN", "en-US"] as const; // AppLocale 只服务 renderer i18n，不替代设置快照中的 app_language

export const PROJECT_SAVE_MODES = ["MANUAL", "FIXED", "SOURCE"] as const; // ProjectSaveMode 是项目保存位置策略，页面和设置服务都从这里取合法值

export type AppLanguage = (typeof APP_LANGUAGES)[number];
export type AppLocale = (typeof APP_LOCALES)[number];
export type ProjectSaveMode = (typeof PROJECT_SAVE_MODES)[number];
type SettingJsonRecord = Record<string, JsonValue>;

type RecentProjectSetting = {
  path: string; // 最近工程路径
  name: string; // 最近工程展示名
  updated_at: string; // 最近工程更新时间
};

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
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
]);

const NUMBER_SETTING_KEYS = new Set(["request_timeout", "preceding_lines_threshold"]);

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
  public readonly data: SettingJsonRecord; // 完整设置文件形状；settings 快照只从白名单派生

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
          setting[key] = value;
        }
      }
    }
    return new Setting(setting);
  }

  /**
   * 输出完整设置文件形状，模型配置等非 settings 快照字段仍保留在同一落盘对象内
   */
  public to_json(): SettingJsonRecord {
    return { ...this.data };
  }

  /**
   * 构建 renderer 可见 settings 快照，隔离 config.json 历史内部形状
   */
  public to_snapshot(): SettingJsonRecord {
    const snapshot: SettingJsonRecord = {};
    for (const key of SETTING_KEYS) {
      snapshot[key] = this.data[key] ?? DEFAULT_SETTING[key];
    }
    return snapshot;
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
    if (BOOLEAN_SETTING_KEYS.has(key)) {
      return Boolean(value);
    }
    if (NUMBER_SETTING_KEYS.has(key)) {
      return Number(value ?? 0);
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
   * i18n locale 是 app_language 的派生结果，不单独持久化为第二状态源
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

  private static build_recent_project_display_name(project_path: string): string {
    const base = project_path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
    const dot_index = base.lastIndexOf(".");
    return dot_index > 0 ? base.slice(0, dot_index) : base;
  }
}

// 设置文件和设置页 payload 统一通过这里确认语言值域
export function is_app_language(value: unknown): value is AppLanguage {
  return APP_LANGUAGE_SET.has(value as AppLanguage);
}

// 项目保存模式写入设置前先确认合法值，避免页面草稿值落盘
export function is_project_save_mode(value: unknown): value is ProjectSaveMode {
  return PROJECT_SAVE_MODE_SET.has(value as ProjectSaveMode);
}

export const normalize_app_language = Setting.normalize_app_language;
export const resolve_app_locale = Setting.resolve_app_locale;
export const normalize_project_save_mode = Setting.normalize_project_save_mode;
