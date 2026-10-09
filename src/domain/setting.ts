import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { read_json_boolean, type JsonRecord, type JsonValue } from "./json";
import { normalize_app_language, APP_LANGUAGE_DEFINITIONS } from "./app-language";
import { normalize_model_selection } from "./model";
import { normalize_agent_skill_settings } from "./agent-skill-settings";

export {
  ALL_LANGUAGE_CODE,
  LANGUAGE_CODES,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  has_language_character,
  is_language_character,
  normalize_language_code,
  normalize_source_language_code,
  normalize_target_language_code,
  type ConfiguredSourceLanguageCode,
  type LanguageCode,
  type SourceLanguageCode,
  type TargetLanguageCode,
} from "./language";

export const PROJECT_SAVE_MODES = ["MANUAL", "FIXED", "SOURCE"] as const; // ProjectSaveMode 是项目保存位置策略，页面和设置服务都从这里取合法值

export type ProjectSaveMode = (typeof PROJECT_SAVE_MODES)[number];
/** 应用级工程写入审批偏好，跨对话、工程和应用重启保留。 */
export const AGENT_APPROVAL_MODES = ["manual", "auto"] as const;
export type AgentApprovalMode = (typeof AGENT_APPROVAL_MODES)[number];
export const RECENT_PROJECT_SETTING_SCHEMA = Type.Object({
  path: Type.String(), // 最近工程路径。
  name: Type.String(), // 最近工程展示名。
  updated_at: Type.String(), // 最近工程访问时间文本。
});
export type RecentProjectSetting = Static<typeof RECENT_PROJECT_SETTING_SCHEMA>;
export const SETTING_SNAPSHOT_SCHEMA = Type.Object(
  {
    agent_approval_mode: Type.Enum(AGENT_APPROVAL_MODES), // Agent 工程写入的审批方式。
    app_language: Type.Enum(APP_LANGUAGE_DEFINITIONS.map(({ code }) => code)), // 界面与日志文案的应用语言。
    source_language: Type.String(), // 源语言允许 `ALL`，由具体过滤器进一步收窄。
    target_language: Type.String(), // 译文目标语言，参与提示词和工程设置镜像。
    project_save_mode: Type.Enum(PROJECT_SAVE_MODES), // 新建工程的保存位置策略。
    project_fixed_path: Type.String(), // 固定保存模式使用的工程目录。
    output_folder_open_on_finish: Type.Boolean(), // 译文生成成功后是否打开输出目录。
    request_timeout: Type.Number(), // 等待模型回复的超时时间，单位为秒。
    preceding_lines_threshold: Type.Number(), // 单个翻译任务最多携带的参考上文行数。
    clean_ruby: Type.Boolean(), // 翻译文本的注音清理开关。
    deduplication_in_bilingual: Type.Boolean(), // 双语文件原译文相同时是否只写一份正文。
    write_translated_name_fields_to_file: Type.Boolean(), // 导出时是否使用角色译名。
    prompt_enhancement_enable: Type.Boolean(), // 翻译提示词增强开关。
    agent_batch_translation_thinking_adaptive_enable: Type.Boolean(), // 控制 Agent 跟随翻译的临时思考等级。
    mtool_optimizer_enable: Type.Boolean(), // MTool 文本预过滤优化开关。
    skip_duplicate_source_text_enable: Type.Boolean(), // 重复来源条目的过滤开关。
    glossary_default_preset: Type.String(), // 术语表默认预设标识。
    text_preserve_default_preset: Type.String(), // 文本保护默认预设标识。
    pre_translation_replacement_default_preset: Type.String(), // 翻译前替换默认预设标识。
    post_translation_replacement_default_preset: Type.String(), // 翻译后替换默认预设标识。
    translation_custom_prompt_default_preset: Type.String(), // 自定义翻译提示词默认预设标识。
    recent_projects: Type.Array(RECENT_PROJECT_SETTING_SCHEMA), // 最近访问的工程列表。
  },
  { additionalProperties: false },
);
export type SettingSnapshot = Static<typeof SETTING_SNAPSHOT_SCHEMA>;

export const PROJECT_SETTING_KEYS = [
  "source_language",
  "target_language",
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
] as const;

export const PROJECT_SETTINGS_SNAPSHOT_SCHEMA = Type.Pick(SETTING_SNAPSHOT_SCHEMA, [
  ...PROJECT_SETTING_KEYS,
]);
export type ProjectSettingsSnapshot = Static<typeof PROJECT_SETTINGS_SNAPSHOT_SCHEMA>;
export const SETTING_KEYS = Object.keys(
  SETTING_SNAPSHOT_SCHEMA.properties,
) as (keyof SettingSnapshot)[];
type SettingKey = keyof SettingSnapshot;

export const DEFAULT_SETTING: SettingSnapshot & JsonRecord = {
  agent_approval_mode: "manual",
  app_language: "ZH",
  source_language: "JA",
  target_language: "ZH",
  project_save_mode: "MANUAL",
  project_fixed_path: "",
  output_folder_open_on_finish: false,
  request_timeout: 180,
  preceding_lines_threshold: 0,
  clean_ruby: false,
  deduplication_in_bilingual: true,
  write_translated_name_fields_to_file: true,
  prompt_enhancement_enable: true,
  agent_batch_translation_thinking_adaptive_enable: true,
  mtool_optimizer_enable: true,
  skip_duplicate_source_text_enable: true,
  glossary_default_preset: "",
  text_preserve_default_preset: "",
  pre_translation_replacement_default_preset: "",
  post_translation_replacement_default_preset: "",
  translation_custom_prompt_default_preset: "",

  recent_projects: [],
  model_selection: {
    translation: "",

    agent: "",
    agent_batch_translation: null,
  },
  models: null,
  agent_skills: { disabled: { builtin: [], user: [] }, user_order: [] },
  agent_personality: null,
};

const PROJECT_SAVE_MODE_SET = new Set<ProjectSaveMode>(PROJECT_SAVE_MODES);

/**
 * Setting 是 userdata/config.json 的业务实体；文件名保留 config.json，但领域语义统一为设置
 */
export class Setting {
  public readonly data: JsonRecord; // 完整设置文件形状；设置快照只从白名单计算

  /** 保存从 JSON 归一后的设置字段。 */
  private constructor(data: JsonRecord) {
    this.data = data;
  }

  /**
   * 从 userdata 设置文件或页面 payload 反序列化，并只保留当前已知设置字段
   */
  public static from_json(payload: unknown): Setting {
    const setting = { ...DEFAULT_SETTING };
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      for (const [key, value] of Object.entries(payload as JsonRecord)) {
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
  public to_json(): JsonRecord {
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
    return normalize_recent_project_settings(this.data["recent_projects"]);
  }

  /**
   * 归一设置字段，防止未知类型写入设置文件
   */
  public static normalize_value(key: string, value: JsonValue): JsonValue {
    if (key === "agent_approval_mode") return normalize_agent_approval_mode(value);
    if (key === "agent_personality") return typeof value === "string" ? value : null;
    if (key === "agent_skills") return normalize_agent_skill_settings(value);
    if (key === "app_language") {
      return normalize_app_language(value);
    }
    if (key === "project_save_mode") {
      return Setting.normalize_project_save_mode(value);
    }
    if (key === "recent_projects") {
      return normalize_recent_project_settings(value) as unknown as JsonValue;
    }
    if (key === "model_selection") {
      return normalize_model_selection(value) as unknown as JsonValue;
    }
    const schema = SETTING_SNAPSHOT_SCHEMA.properties[key as SettingKey];
    if (Type.IsBoolean(schema)) {
      return read_json_boolean(value, Boolean(DEFAULT_SETTING[key]));
    }
    if (Type.IsNumber(schema)) {
      return normalize_number_setting(value, Number(DEFAULT_SETTING[key] ?? 0));
    }
    if (key in DEFAULT_SETTING && key !== "models") {
      return String(value ?? DEFAULT_SETTING[key] ?? "");
    }
    return value;
  }

  /**
   * 缺失或未知保存模式按历史手动保存策略处理
   */
  public static normalize_project_save_mode(value: unknown): ProjectSaveMode {
    return is_project_save_mode(value) ? value : "MANUAL";
  }

  /** 兼容两种路径分隔符，从文件名去除最后一个扩展名。 */
  private static build_recent_project_display_name(project_path: string): string {
    const base = project_path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
    const dot_index = base.lastIndexOf(".");
    return dot_index > 0 ? base.slice(0, dot_index) : base;
  }
}

// 项目保存模式写入设置前先确认合法值，避免页面草稿值落盘
export function is_project_save_mode(value: unknown): value is ProjectSaveMode {
  return PROJECT_SAVE_MODE_SET.has(value as ProjectSaveMode);
}

/** 写入命令据此拒绝非法模式；读取配置时由归一化入口补默认值。 */
export function is_agent_approval_mode(value: unknown): value is AgentApprovalMode {
  return Check(SETTING_SNAPSHOT_SCHEMA.properties.agent_approval_mode, value);
}

/** 旧配置缺失或存储值无效时使用手动审批。 */
export function normalize_agent_approval_mode(value: unknown): AgentApprovalMode {
  return is_agent_approval_mode(value) ? value : "manual";
}

/**
 * 渲染进程、主进程和 worker 的设置快照只从这一处补默认值和收窄类型
 */
export function normalize_setting_snapshot(value: unknown): SettingSnapshot {
  const record = read_setting_record(value);
  return Object.fromEntries(
    SETTING_KEYS.map((key) => {
      const normalized = Setting.normalize_value(key, record[key] ?? DEFAULT_SETTING[key]);
      // 落盘文本保留用户输入，公开快照裁剪路径与预设名，语言标识使用大写。
      const text = Type.IsString(SETTING_SNAPSHOT_SCHEMA.properties[key])
        ? String(normalized).trim()
        : normalized;
      return [
        key,
        key === "source_language" || key === "target_language" ? String(text).toUpperCase() : text,
      ];
    }),
  ) as SettingSnapshot;
}

/**
 * 项目设置镜像只保留会影响预过滤、提示词和目标语言展示的窄字段
 */
export function normalize_project_settings_snapshot(
  value: unknown,
  fallback: ProjectSettingsSnapshot = DEFAULT_SETTING,
): ProjectSettingsSnapshot {
  const record = read_setting_record(value);
  return Object.fromEntries(
    PROJECT_SETTING_KEYS.map((key) => [
      key,
      PROJECT_SETTINGS_SNAPSHOT_SCHEMA.properties[key].type === "string"
        ? read_project_string_setting(record[key], String(fallback[key]))
        : read_json_boolean(record[key], Boolean(fallback[key])),
    ]),
  ) as ProjectSettingsSnapshot;
}

/** 设置读取以合法 JSON 对象为起点，其余输入视为空配置。 */
function read_setting_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/** 空项目设置继承调用方基线，其余值裁剪并使用大写。 */
function read_project_string_setting(value: JsonValue | undefined, fallback: string): string {
  const text = String(value ?? "").trim();
  return text === "" ? fallback : text.toUpperCase();
}

/** 有限数值才进入设置，缺失和非有限值沿用基线。 */
function normalize_number_setting(value: unknown, fallback: number): number {
  const number_value = Number(value ?? fallback);
  return Number.isFinite(number_value) ? number_value : fallback;
}

/** 规范化最近工程记录并过滤缺失路径的条目。 */
function normalize_recent_project_settings(value: unknown): RecentProjectSetting[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is JsonRecord => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    })
    .map((item) => ({
      path: String(item["path"] ?? "").trim(),
      name: String(item["name"] ?? "").trim(),
      updated_at: String(item["updated_at"] ?? "").trim(),
    }))
    .filter((item) => item.path !== "");
}

export const normalize_project_save_mode = Setting.normalize_project_save_mode;
