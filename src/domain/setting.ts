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
/** 出站代理模式；system 使用操作系统设置，manual 使用应用内配置的代理服务器。 */
export const PROXY_MODES = ["direct", "system", "manual"] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];
/** 手动模式的代理协议。 */
export const PROXY_PROTOCOLS = ["HTTP", "HTTPS", "SOCKS5"] as const;
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];
/** 代理设置整体写入，设置文件与快照都不会出现只改一半的手动配置。 */
export const PROXY_SETTING_SCHEMA = Type.Object(
  {
    mode: Type.Enum(PROXY_MODES), // 出站代理模式。
    protocol: Type.Enum(PROXY_PROTOCOLS), // 手动模式的代理协议。
    host: Type.String(), // 手动模式的代理主机，不含协议前缀与端口。
    port: Type.Number(), // 手动模式的代理端口，未配置为 0。
    username: Type.String(), // 手动模式的代理认证用户名。
    password: Type.String(), // 手动模式的代理认证密码，保留空格。
  },
  { additionalProperties: false },
);
export type ProxySettingValue = Static<typeof PROXY_SETTING_SCHEMA>;
export const DEFAULT_PROXY_SETTING: ProxySettingValue = {
  mode: "system",
  protocol: "HTTP",
  host: "",
  port: 0,
  username: "",
  password: "",
};
/** 手动模式的必填字段；命令层据此拒绝保存并定位到界面控件。 */
export type ProxySettingField = "proxy.host" | "proxy.port" | "proxy.username";

/**
 * 解析后的代理设置；手动字段不完整时按跟随系统出站，由 effective_mode 给出实际模式。
 */
export interface ResolvedProxySetting extends ProxySettingValue {
  effective_mode: ProxyMode; // 出站实际使用的模式，手动字段不完整时为 system
  incomplete_field: ProxySettingField | null; // 手动模式下首个缺失或越界的字段
}
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
    project_save_mode: Type.Enum(PROJECT_SAVE_MODES), // 新建工程的保存位置策略。
    project_fixed_path: Type.String(), // 固定保存模式使用的工程目录。
    output_folder_open_on_finish: Type.Boolean(), // 译文生成成功后是否打开输出目录。
    request_timeout: Type.Number(), // 等待模型回复的超时时间，单位为秒。
    preceding_lines_threshold: Type.Number(), // 单个翻译任务最多携带的参考上文行数。
    clean_ruby: Type.Boolean(), // 翻译文本的注音清理开关。
    deduplication_in_bilingual: Type.Boolean(), // 双语文件原译文相同时是否只写一份正文。
    write_translated_name_fields_to_file: Type.Boolean(), // 导出时是否使用角色译名。
    prompt_enhancement_enable: Type.Boolean(), // 翻译提示词增强开关。
    mtool_optimizer_enable: Type.Boolean(), // MTool 文本预过滤优化开关。
    skip_duplicate_source_text_enable: Type.Boolean(), // 重复来源条目的过滤开关。
    glossary_default_preset: Type.String(), // 术语表默认预设标识。
    text_preserve_default_preset: Type.String(), // 文本保护默认预设标识。
    pre_translation_replacement_default_preset: Type.String(), // 翻译前替换默认预设标识。
    post_translation_replacement_default_preset: Type.String(), // 翻译后替换默认预设标识。
    translation_custom_prompt_default_preset: Type.String(), // 自定义翻译提示词默认预设标识。
    proxy: PROXY_SETTING_SCHEMA, // 出站代理配置。
    recent_projects: Type.Array(RECENT_PROJECT_SETTING_SCHEMA), // 最近访问的工程列表。
  },
  { additionalProperties: false },
);
export type SettingSnapshot = Static<typeof SETTING_SNAPSHOT_SCHEMA>;

export const SETTING_KEYS = Object.keys(
  SETTING_SNAPSHOT_SCHEMA.properties,
) as (keyof SettingSnapshot)[];
type SettingKey = keyof SettingSnapshot;

export const DEFAULT_SETTING: SettingSnapshot & JsonRecord = {
  agent_approval_mode: "manual",
  app_language: "ZH",
  project_save_mode: "MANUAL",
  project_fixed_path: "",
  output_folder_open_on_finish: false,
  request_timeout: 180,
  preceding_lines_threshold: 0,
  clean_ruby: false,
  deduplication_in_bilingual: true,
  write_translated_name_fields_to_file: true,
  prompt_enhancement_enable: true,
  mtool_optimizer_enable: true,
  skip_duplicate_source_text_enable: true,
  glossary_default_preset: "",
  text_preserve_default_preset: "",
  pre_translation_replacement_default_preset: "",
  post_translation_replacement_default_preset: "",
  translation_custom_prompt_default_preset: "",

  proxy: { ...DEFAULT_PROXY_SETTING },

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
    if (key === "proxy") {
      return normalize_proxy_setting(value) as unknown as JsonValue;
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

/** 写入命令据此拒绝非法代理模式；读取配置时由归一化入口补默认值。 */
export function is_proxy_mode(value: unknown): value is ProxyMode {
  return Check(PROXY_SETTING_SCHEMA.properties.mode, value);
}

/** 写入命令据此拒绝非法代理协议；读取配置时由归一化入口补默认值。 */
export function is_proxy_protocol(value: unknown): value is ProxyProtocol {
  return Check(PROXY_SETTING_SCHEMA.properties.protocol, value);
}

/** 缺失或非法模式按跟随系统处理，行为与旧版本一致。 */
export function normalize_proxy_mode(value: unknown): ProxyMode {
  return is_proxy_mode(value) ? value : DEFAULT_PROXY_SETTING.mode;
}

/** 缺失或非法协议按 HTTP 处理。 */
export function normalize_proxy_protocol(value: unknown): ProxyProtocol {
  return is_proxy_protocol(value) ? value : DEFAULT_PROXY_SETTING.protocol;
}

/** 代理端口范围是 1–65535，0 表示未配置。 */
export function is_proxy_port(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * 代理主机只收主机名、IPv4 或方括号形式的 IPv6。
 *
 * 用 URL 解析同一段文本，确保拼接端口后不会产生查询、片段或路径结构；
 * 非法 IPv6（如 `[:::]`）会在解析时被拒绝。
 */
function is_proxy_host(value: string): boolean {
  if (value === "" || /[\s/\\@?#]/u.test(value)) return false;
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return false;
  } else if (value.includes(":")) {
    return false;
  }
  try {
    const target = new URL(`http://${value}/`);
    return (
      target.username === "" &&
      target.password === "" &&
      target.port === "" &&
      target.pathname === "/" &&
      target.search === "" &&
      target.hash === ""
    );
  } catch {
    return false;
  }
}

/** 代理设置逐字段比较；草稿脏标记与宿主切换判断共用同一口径。 */
export function is_same_proxy_setting(left: ProxySettingValue, right: ProxySettingValue): boolean {
  return (
    left.mode === right.mode &&
    left.protocol === right.protocol &&
    left.host === right.host &&
    left.port === right.port &&
    left.username === right.username &&
    left.password === right.password
  );
}

/**
 * 归一代理设置；主机与用户名裁剪空格，密码原样保留，非法枚举回落到默认值
 */
export function normalize_proxy_setting(value: unknown): ProxySettingValue {
  const record = read_setting_record(value);
  return {
    mode: normalize_proxy_mode(record["mode"]),
    protocol: normalize_proxy_protocol(record["protocol"]),
    host: String(record["host"] ?? "").trim(),
    port: normalize_number_setting(record["port"], DEFAULT_PROXY_SETTING.port),
    username: String(record["username"] ?? "").trim(),
    password: String(record["password"] ?? ""),
  };
}

/**
 * 读取代理设置并算出出站实际使用的模式；手动字段不完整时按跟随系统出站
 */
export function read_proxy_setting(value: unknown): ResolvedProxySetting {
  const setting = normalize_proxy_setting(value);
  const incomplete_field = setting.mode === "manual" ? find_incomplete_proxy_field(setting) : null;
  return {
    ...setting,
    effective_mode: incomplete_field === null ? setting.mode : "system",
    incomplete_field,
  };
}

/** 手动模式按界面字段顺序返回首个缺失或越界的字段。 */
function find_incomplete_proxy_field(setting: ProxySettingValue): ProxySettingField | null {
  if (!is_proxy_host(setting.host)) return "proxy.host";
  if (!is_proxy_port(setting.port)) return "proxy.port";
  if (setting.password !== "" && setting.username === "") return "proxy.username";
  return null;
}

/**
 * 渲染进程、主进程和 worker 的设置快照只从这一处补默认值和收窄类型
 */
export function normalize_setting_snapshot(value: unknown): SettingSnapshot {
  const record = read_setting_record(value);
  return Object.fromEntries(
    SETTING_KEYS.map((key) => {
      const normalized = Setting.normalize_value(key, record[key] ?? DEFAULT_SETTING[key]);
      // 落盘文本保留用户输入，公开快照裁剪路径与预设名。
      return [
        key,
        Type.IsString(SETTING_SNAPSHOT_SCHEMA.properties[key])
          ? String(normalized).trim()
          : normalized,
      ];
    }),
  ) as SettingSnapshot;
}

/** 设置读取以合法 JSON 对象为起点，其余输入视为空配置。 */
function read_setting_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
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
