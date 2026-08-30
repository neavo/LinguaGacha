import path from "node:path";

import type { JsonRecord } from "../../../domain/json";
import { t_main_log } from "../../log/log-text";
import { default_native_fs } from "../../../native/native-fs";
import { AppError } from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import { relocate_directory_items } from "../path-relocation";
import type { MigrationDescriptor, StartupMigrationContext } from "../migration-types";

type PresetSource = "builtin" | "user";

// 历史资源布局的固定目录片段，只在本迁移中用于识别旧路径。
const RESOURCE_DIR_NAME = "resource";
const PRESET_DIR_NAME = "preset";
const USER_DIR_NAME = "user";
// 质量规则预设只迁移 JSON，旧 builtin 布局只出现过中英文目录。
const QUALITY_RULE_PRESET_EXTENSION = ".json";
const LANGUAGE_DIR_NAMES = ["zh", "en"] as const;
// 设置 key 到质量规则预设目录名的唯一对应关系，迁移只改这组默认预设字段。
const QUALITY_RULE_PRESET_SETTING_KEYS = {
  glossary_default_preset: "glossary",
  text_preserve_default_preset: "text_preserve",
  pre_translation_replacement_default_preset: "pre_translation_replacement",
  post_translation_replacement_default_preset: "post_translation_replacement",
} as const;
// 迁移文件搬运和配置归一都复用同一目录集合，避免规则类型遗漏。
const QUALITY_RULE_PRESET_DIRECTORIES = Object.values(QUALITY_RULE_PRESET_SETTING_KEYS);

/**
 * 迁移背景：
 * 质量规则预设曾经历同一次体系收敛：用户预设从 `resource/preset/<type>/user`
 * 迁到 `userdata/<type>`，默认配置值从旧路径或 `builtin:<lang>:file.json`
 * 归一为当前 `source:file.json` 虚拟 ID。旧内置目录只用于识别配置来源；
 * 当前内置预设随版本打包，不写入安装目录。
 *
 * 生效场景：
 * Backend 启动、设置服务读取前一次性迁移质量规则预设布局和默认预设引用。
 *
 * 不处理范围：
 * 提示词预设不在本文件处理；无法识别的旧默认预设路径清空并记录 warning，
 * 避免把无效路径继续伪装成可用配置。
 */
export const quality_rule_preset_layout_migration: MigrationDescriptor = {
  id: "quality-rule-preset-layout",
  order: 300,
  /**
   * 质量规则预设体系迁移由三个步骤组成，必须在设置读取前一次完成。
   */
  run_startup(context: StartupMigrationContext): void {
    run_quality_rule_preset_layout_migration(context);
  },
};

/**
 * 执行顺序固定为迁移用户预设，再归一配置值。
 */
export function run_quality_rule_preset_layout_migration(context: StartupMigrationContext): void {
  migrate_user_presets(context);
  normalize_default_preset_config_values(context);
}

/**
 * 只归一质量规则默认预设 key，其它设置原样保留。
 */
export function normalize_quality_rule_preset_setting_payload(
  context: StartupMigrationContext,
  setting_data: JsonRecord,
): [JsonRecord, boolean] {
  const normalized = { ...setting_data };
  let changed = false;
  for (const [setting_key, preset_directory] of Object.entries(QUALITY_RULE_PRESET_SETTING_KEYS)) {
    const current_value = normalized[setting_key];
    if (typeof current_value !== "string" || current_value === "") {
      continue;
    }
    const resolved_value = normalize_quality_rule_preset_value(
      context,
      preset_directory,
      current_value,
    );
    if (resolved_value !== current_value) {
      normalized[setting_key] = resolved_value;
      changed = true;
    }
  }
  return [normalized, changed];
}

/**
 * 兼容旧路径、当前两段式虚拟 ID 和旧 builtin 三段式虚拟 ID。
 */
export function normalize_quality_rule_preset_value(
  context: StartupMigrationContext,
  preset_directory: string,
  value: string,
): string {
  if (value === "") {
    return value;
  }
  const virtual_id = try_normalize_virtual_id(value);
  if (virtual_id !== null) {
    return virtual_id;
  }

  const file_name = path.basename(value);
  if (!file_name.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION)) {
    log_normalize_failure(context, preset_directory, value);
    return "";
  }

  const resolved_source = resolve_source_from_path(context, preset_directory, path.dirname(value));
  if (resolved_source === null) {
    log_normalize_failure(context, preset_directory, value);
    return "";
  }
  return build_virtual_id(resolved_source, file_name);
}

/**
 * 用户预设从 resource 旧目录迁到 userdata，目标同名代表当前用户事实。
 */
function migrate_user_presets(context: StartupMigrationContext): void {
  for (const preset_directory of QUALITY_RULE_PRESET_DIRECTORIES) {
    const destination_dir = context.paths.get_quality_rule_user_preset_dir(preset_directory);
    default_native_fs.make_dir(destination_dir);
    relocate_directory_items(
      context.log_manager,
      get_legacy_user_preset_dir(context, preset_directory),
      destination_dir,
      QUALITY_RULE_PRESET_EXTENSION,
      [context.paths.get_app_root(), context.paths.get_data_root()],
    );
  }
}

/**
 * 配置文件已复制到 userdata 后再写回虚拟 ID，后续 AppSettingService 只读当前位置。
 */
function normalize_default_preset_config_values(context: StartupMigrationContext): void {
  const config_path = context.paths.get_config_path();
  if (!default_native_fs.exists(config_path) || !default_native_fs.stat(config_path).isFile()) {
    return;
  }
  try {
    const setting_data = JsonTool.parseStrict(default_native_fs.read_file(config_path)) as unknown;
    if (typeof setting_data !== "object" || setting_data === null || Array.isArray(setting_data)) {
      return;
    }
    const [normalized_config, changed] = normalize_quality_rule_preset_setting_payload(
      context,
      setting_data as JsonRecord,
    );
    if (!changed) {
      return;
    }
    default_native_fs.write_file_sync(
      config_path,
      JsonTool.stringifyStrict(normalized_config, { indent: 4 }),
    );
  } catch (error) {
    context.log_manager.warning(
      t_main_log("app.diagnostic.default_preset.config_normalize_failed", {
        CONFIG_PATH: config_path,
      }),
      {
        source: "migration",
        error,
      },
    );
  }
}

/**
 * 当前 ID 为 `source:file.json`；旧 builtin ID 为 `builtin:<lang>:file.json`。
 */
function try_normalize_virtual_id(value: string): string | null {
  const parts = value.split(":");
  if (parts.length === 2) {
    const [source, file_name] = parts;
    if (is_preset_source(source) && is_preset_file_name(file_name)) {
      return build_virtual_id(source, file_name);
    }
    return null;
  }
  if (parts.length === 3) {
    const [source, language, file_name] = parts;
    if (
      source === "builtin" &&
      LANGUAGE_DIR_NAMES.includes(language.toLowerCase() as (typeof LANGUAGE_DIR_NAMES)[number]) &&
      is_preset_file_name(file_name)
    ) {
      return build_virtual_id(source, file_name);
    }
  }
  return null;
}

/**
 * 旧配置保存的是路径，只能通过所在目录反推出 user/builtin 来源。
 */
function resolve_source_from_path(
  context: StartupMigrationContext,
  preset_directory: string,
  raw_dir: string,
): PresetSource | null {
  const user_dirs = [
    context.paths.get_quality_rule_user_preset_dir(preset_directory),
    get_legacy_user_preset_dir(context, preset_directory),
  ];
  if (user_dirs.some((directory) => is_same_directory(context, raw_dir, directory))) {
    return "user";
  }

  const builtin_dirs = [
    context.paths.get_quality_rule_builtin_preset_dir(preset_directory),
    ...get_legacy_builtin_preset_dirs(context, preset_directory),
  ];
  if (builtin_dirs.some((directory) => is_same_directory(context, raw_dir, directory))) {
    return "builtin";
  }
  return null;
}

/**
 * 旧用户预设目录固定为 `resource/preset/<type>/user`。
 */
function get_legacy_user_preset_dir(
  context: StartupMigrationContext,
  preset_directory: string,
): string {
  return path.join(
    context.paths.get_app_root(),
    RESOURCE_DIR_NAME,
    PRESET_DIR_NAME,
    preset_directory,
    USER_DIR_NAME,
  );
}

/**
 * 旧 builtin 同时兼容 `resource/<type>/preset/<lang>` 与 `resource/preset/<type>/<lang>`。
 */
function get_legacy_builtin_preset_dirs(
  context: StartupMigrationContext,
  preset_directory: string,
): string[] {
  const directories: string[] = [];
  for (const language of LANGUAGE_DIR_NAMES) {
    directories.push(
      path.join(
        context.paths.get_app_root(),
        RESOURCE_DIR_NAME,
        preset_directory,
        PRESET_DIR_NAME,
        language,
      ),
    );
    directories.push(
      path.join(
        context.paths.get_app_root(),
        RESOURCE_DIR_NAME,
        PRESET_DIR_NAME,
        preset_directory,
        language,
      ),
    );
  }
  return directories;
}

/**
 * 默认预设配置可能保存绝对路径或相对 app/data 根路径，必须同时接受。
 */
function is_same_directory(
  context: StartupMigrationContext,
  raw_dir: string,
  expected_dir: string,
): boolean {
  const raw_normalized = normalize_path_key(raw_dir);
  const candidates = new Set([normalize_path_key(expected_dir)]);
  for (const base_root of [context.paths.get_app_root(), context.paths.get_data_root()]) {
    const relative_dir = path.relative(base_root, expected_dir);
    if (relative_dir !== "" && !relative_dir.startsWith("..") && !path.isAbsolute(relative_dir)) {
      candidates.add(normalize_path_key(relative_dir));
    }
  }
  return candidates.has(raw_normalized);
}

/**
 * 输出当前稳定虚拟 ID，写入前收窄扩展名。
 */
function build_virtual_id(source: PresetSource, file_name: string): string {
  if (!is_preset_file_name(file_name)) {
    throw new AppError("runtime.internal_invariant", {
      diagnostic_context: {
        reason: "invalid_quality_rule_preset_file_name",
        file_name,
      },
    });
  }
  return `${source}:${file_name}`;
}

/**
 * 预设来源只允许当前公开的 builtin/user 两类。
 */
function is_preset_source(value: string): value is PresetSource {
  return value === "builtin" || value === "user";
}

/**
 * 质量规则预设只接受 JSON 文件名，避免把目录或提示词预设写进配置。
 */
function is_preset_file_name(value: string): boolean {
  return value !== "" && value.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION);
}

/**
 * 路径比较 key 兼容 Windows 大小写和分隔符差异。
 */
function normalize_path_key(value: string): string {
  const normalized = path.normalize(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * 无法识别旧值时清空配置并记录 warning，避免运行态继续消费坏路径。
 */
function log_normalize_failure(
  context: StartupMigrationContext,
  preset_directory: string,
  value: string,
): void {
  context.log_manager.warning(
    t_main_log("app.diagnostic.default_preset.value_normalize_failed", {
      PRESET_DIRECTORY: preset_directory,
      VALUE: value,
    }),
    { source: "migration" },
  );
}
