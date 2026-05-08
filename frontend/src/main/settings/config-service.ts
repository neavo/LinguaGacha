import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { CoreBridgeClient } from "../core/core-bridge-client";
import { AppPathService } from "../paths/app-path-service";
import { JsonTool } from "../../utils/json-tool";

type ConfigRecord = Record<string, ApiJsonValue>;

const SETTING_KEYS = [
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

const BOOLEAN_SETTING_KEYS = new Set([
  "output_folder_open_on_finish",
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
]);

const NUMBER_SETTING_KEYS = new Set(["request_timeout", "preceding_lines_threshold"]);

const DEFAULT_CONFIG: ConfigRecord = {
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

/**
 * 封装应用设置与最近项目配置文件的唯一写入口。
 */
export class ConfigService {
  private readonly paths: AppPathService;
  private readonly core_bridge: CoreBridgeClient | null;

  /**
   * 初始化 ConfigService 依赖，保持外部写入口清晰。
   */
  public constructor(paths: AppPathService, core_bridge: CoreBridgeClient | null = null) {
    this.paths = paths;
    this.core_bridge = core_bridge;
  }

  /**
   * 读取应用设置快照，保持 UI 只消费白名单字段。
   */
  public get_app_settings(): Record<string, ApiJsonValue> {
    const config = this.load_config();
    this.save_config(config);
    return { settings: this.build_settings_snapshot(config) };
  }

  /**
   * 更新应用设置白名单字段，并同步 Python Core 运行时。
   */
  public async update_app_settings(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const config = this.load_config();
    const changed_keys: string[] = [];
    for (const [key, value] of Object.entries(request)) {
      if (!SETTING_KEYS.includes(key as (typeof SETTING_KEYS)[number])) {
        continue;
      }
      config[key] = this.normalize_setting_value(key, value);
      changed_keys.push(key);
    }
    if (changed_keys.length > 0) {
      this.save_config(config);
      await this.core_bridge?.sync_runtime("settings_changed", {
        keys: changed_keys,
        settings: this.build_settings_snapshot(config),
      });
    }
    return { settings: this.build_settings_snapshot(config) };
  }

  /**
   * 写入最近项目列表，集中去重和数量限制。
   */
  public async add_recent_project(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = typeof request["path"] === "string" ? request["path"] : "";
    const config = this.load_config();
    if (project_path !== "") {
      config["recent_projects"] = this.build_recent_projects_after_add(
        this.read_recent_projects(config),
        project_path,
      );
      this.save_config(config);
      await this.core_bridge?.sync_runtime("settings_changed", {
        keys: ["recent_projects"],
        settings: this.build_settings_snapshot(config),
      });
    }
    return { settings: this.build_settings_snapshot(config) };
  }

  /**
   * 移除最近项目，保持配置文件列表结构稳定。
   */
  public async remove_recent_project(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = typeof request["path"] === "string" ? request["path"] : "";
    const config = this.load_config();
    if (project_path !== "") {
      config["recent_projects"] = this.read_recent_projects(config).filter((item) => {
        return item.path !== project_path;
      }) as unknown as ApiJsonValue;
      this.save_config(config);
      await this.core_bridge?.sync_runtime("settings_changed", {
        keys: ["recent_projects"],
        settings: this.build_settings_snapshot(config),
      });
    }
    return { settings: this.build_settings_snapshot(config) };
  }

  /**
   * 读取配置文件并补齐默认值，兼容旧 userdata。
   */
  public load_config(): ConfigRecord {
    const config_path = this.paths.get_config_path();
    const config = { ...DEFAULT_CONFIG };
    if (fs.existsSync(config_path)) {
      const parsed = JsonTool.parseStrict(fs.readFileSync(config_path)) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, ApiJsonValue>)) {
          if (key in DEFAULT_CONFIG) {
            config[key] = value;
          }
        }
      }
    }
    return config;
  }

  /**
   * 持久化配置对象，确保目录存在后再写入。
   */
  public save_config(config: ConfigRecord): void {
    const config_path = this.paths.get_config_path();
    fs.mkdirSync(path.dirname(config_path), { recursive: true });
    fs.writeFileSync(config_path, JsonTool.stringifyStrict(config, { indent: 4 }), "utf-8");
  }

  /**
   * 构建设置响应快照，隔离 config.json 内部形状。
   */
  public build_settings_snapshot(config: ConfigRecord): Record<string, ApiJsonValue> {
    const snapshot: Record<string, ApiJsonValue> = {};
    for (const key of SETTING_KEYS) {
      snapshot[key] = config[key] ?? DEFAULT_CONFIG[key];
    }
    return snapshot;
  }

  /**
   * 归一设置字段，防止未知类型写入配置。
   */
  private normalize_setting_value(key: string, value: ApiJsonValue): ApiJsonValue {
    if (key === "app_language") {
      const language = String(value ?? "")
        .trim()
        .toUpperCase();
      if (language !== "ZH" && language !== "EN") {
        throw new Error("应用语言只支持 ZH 或 EN。");
      }
      return language;
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
   * 读取最近项目列表，兼容旧配置中的缺失字段。
   */
  private read_recent_projects(
    config: ConfigRecord,
  ): Array<{ path: string; name: string; updated_at: string }> {
    const raw_items = config["recent_projects"];
    if (!Array.isArray(raw_items)) {
      return [];
    }
    return raw_items
      .filter((item): item is Record<string, ApiJsonValue> => {
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
   * 生成新增后的最近项目列表，统一去重和截断规则。
   */
  private build_recent_projects_after_add(
    current_items: Array<{ path: string; name: string; updated_at: string }>,
    project_path: string,
  ): ApiJsonValue {
    const filtered_items = current_items.filter((item) => item.path !== project_path);
    filtered_items.unshift({
      path: project_path,
      name: this.build_recent_project_display_name(project_path),
      updated_at: this.build_local_iso_timestamp(),
    });
    return filtered_items.slice(0, 10) as unknown as ApiJsonValue;
  }

  /**
   * 生成最近项目展示名，避免 UI 自行解析路径。
   */
  private build_recent_project_display_name(project_path: string): string {
    const parsed = path.parse(project_path);
    return parsed.name || parsed.base;
  }

  /**
   * 生成本地时区时间戳，保持最近项目排序可读。
   */
  private build_local_iso_timestamp(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, "0");
    const year = now.getFullYear().toString().padStart(4, "0");
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    const milliseconds = now.getMilliseconds().toString().padStart(3, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
  }
}
