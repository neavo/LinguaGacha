import path from "node:path";

import type { ApiJsonValue } from "../../api/api-types";
import { t_main_log } from "../../log/log-text";
import { default_native_fs } from "../../../native/platform/native-fs";
import { InternalInvariantError } from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import { PathRelocation } from "../path-relocation";
import type { MigrationDescriptor, StartupMigrationContext } from "../migration-types";

type SettingFileRecord = Record<string, ApiJsonValue>;
type PresetSource = "builtin" | "user";

// 下面这些目录名是历史资源布局和当前路径服务之间的显式映射边界。
const RESOURCE_DIR_NAME = "resource";
const PRESET_DIR_NAME = "preset";
const USER_DIR_NAME = "user";
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
 * 迁到 `userdata/<type>`，内置预设从按语言分层的旧目录迁到
 * `resource/<type>/preset`，默认配置值从路径或 `builtin:<lang>:file.json`
 * 归一为当前 `source:file.json` 虚拟 ID。
 *
 * 生效场景：
 * Core 启动、设置服务读取前一次性迁移质量规则预设布局和默认预设引用。
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
    QualityRulePresetLayoutMigration.run(context);
  },
};

/**
 * 负责质量规则预设的一次性体系迁移：文件搬运、builtin 布局收敛和默认预设值归一。
 */
export class QualityRulePresetLayoutMigration {
  /**
   * 执行顺序固定为搬用户预设、搬 builtin、最后归一配置值，确保路径判定能命中当前和旧目录。
   */
  public static run(context: StartupMigrationContext): void {
    this.migrate_user_presets(context);
    this.migrate_builtin_layout(context);
    this.normalize_default_preset_config_values(context);
  }

  /**
   * 只归一质量规则默认预设 key，其它设置原样保留。
   */
  public static normalize_setting_payload(
    context: StartupMigrationContext,
    setting_data: SettingFileRecord,
  ): [SettingFileRecord, boolean] {
    const normalized = { ...setting_data };
    let changed = false;
    for (const [setting_key, preset_directory] of Object.entries(
      QUALITY_RULE_PRESET_SETTING_KEYS,
    )) {
      const current_value = normalized[setting_key];
      if (typeof current_value !== "string" || current_value === "") {
        continue;
      }
      const resolved_value = this.normalize_default_preset_value(
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
  public static normalize_default_preset_value(
    context: StartupMigrationContext,
    preset_directory: string,
    value: string,
  ): string {
    if (value === "") {
      return value;
    }
    const virtual_id = this.try_normalize_virtual_id(value);
    if (virtual_id !== null) {
      return virtual_id;
    }

    const file_name = path.basename(value);
    if (!file_name.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION)) {
      this.log_normalize_failure(context, preset_directory, value);
      return "";
    }

    const resolved_source = this.resolve_source_from_path(
      context,
      preset_directory,
      path.dirname(value),
    );
    if (resolved_source === null) {
      this.log_normalize_failure(context, preset_directory, value);
      return "";
    }
    return this.build_virtual_id(resolved_source, file_name);
  }

  /**
   * 用户预设从 resource 旧目录迁到 userdata，目标同名代表当前用户事实。
   */
  private static migrate_user_presets(context: StartupMigrationContext): void {
    const relocation = new PathRelocation(context.log_manager);
    for (const preset_directory of QUALITY_RULE_PRESET_DIRECTORIES) {
      const destination_dir = context.paths.get_quality_rule_user_preset_dir(preset_directory);
      default_native_fs.make_dir(destination_dir);
      relocation.relocate_directory_items(
        this.get_legacy_user_preset_dir(context, preset_directory),
        destination_dir,
        QUALITY_RULE_PRESET_EXTENSION,
        [context.paths.get_app_root(), context.paths.get_data_root()],
      );
    }
  }

  /**
   * builtin 预设从两种历史语言层级迁到 `resource/<type>/preset`。
   */
  private static migrate_builtin_layout(context: StartupMigrationContext): void {
    const relocation = new PathRelocation(context.log_manager);
    for (const preset_directory of QUALITY_RULE_PRESET_DIRECTORIES) {
      const destination_dir = context.paths.get_quality_rule_builtin_preset_dir(preset_directory);
      default_native_fs.make_dir(destination_dir);
      for (const source_dir of this.iter_builtin_source_dirs(context, preset_directory)) {
        relocation.relocate_directory_items(
          source_dir,
          destination_dir,
          QUALITY_RULE_PRESET_EXTENSION,
          [context.paths.get_app_root(), context.paths.get_data_root()],
        );
      }
    }
  }

  /**
   * 配置文件已复制到 userdata 后再写回虚拟 ID，后续 AppSettingService 只读当前位置。
   */
  private static normalize_default_preset_config_values(context: StartupMigrationContext): void {
    const config_path = context.paths.get_config_path();
    if (!default_native_fs.exists(config_path) || !default_native_fs.stat(config_path).isFile()) {
      return;
    }
    try {
      const setting_data = JsonTool.parseStrict(
        default_native_fs.read_file(config_path),
      ) as unknown;
      if (
        typeof setting_data !== "object" ||
        setting_data === null ||
        Array.isArray(setting_data)
      ) {
        return;
      }
      const [normalized_config, changed] = this.normalize_setting_payload(
        context,
        setting_data as SettingFileRecord,
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
          error_message: error instanceof Error ? error.message : undefined,
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
    }
  }

  /**
   * 当前 ID 为 `source:file.json`；旧 builtin ID 为 `builtin:<lang>:file.json`。
   */
  private static try_normalize_virtual_id(value: string): string | null {
    const parts = value.split(":");
    if (parts.length === 2) {
      const [source, file_name] = parts;
      if (this.is_preset_source(source) && this.is_preset_file_name(file_name)) {
        return this.build_virtual_id(source, file_name);
      }
      return null;
    }
    if (parts.length === 3) {
      const [source, language, file_name] = parts;
      if (
        source === "builtin" &&
        LANGUAGE_DIR_NAMES.includes(
          language.toLowerCase() as (typeof LANGUAGE_DIR_NAMES)[number],
        ) &&
        this.is_preset_file_name(file_name)
      ) {
        return this.build_virtual_id(source, file_name);
      }
    }
    return null;
  }

  /**
   * 旧配置保存的是路径，只能通过所在目录反推出 user/builtin 来源。
   */
  private static resolve_source_from_path(
    context: StartupMigrationContext,
    preset_directory: string,
    raw_dir: string,
  ): PresetSource | null {
    const user_dirs = [
      context.paths.get_quality_rule_user_preset_dir(preset_directory),
      this.get_legacy_user_preset_dir(context, preset_directory),
    ];
    if (user_dirs.some((directory) => this.is_same_directory(context, raw_dir, directory))) {
      return "user";
    }

    const builtin_dirs = [
      context.paths.get_quality_rule_builtin_preset_dir(preset_directory),
      ...this.iter_builtin_source_dirs(context, preset_directory),
    ];
    if (builtin_dirs.some((directory) => this.is_same_directory(context, raw_dir, directory))) {
      return "builtin";
    }
    return null;
  }

  /**
   * 旧用户预设目录固定为 `resource/preset/<type>/user`。
   */
  private static get_legacy_user_preset_dir(
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
  private static iter_builtin_source_dirs(
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
  private static is_same_directory(
    context: StartupMigrationContext,
    raw_dir: string,
    expected_dir: string,
  ): boolean {
    const raw_normalized = this.normalize_path_key(raw_dir);
    const candidates = new Set([this.normalize_path_key(expected_dir)]);
    for (const base_root of [context.paths.get_app_root(), context.paths.get_data_root()]) {
      const relative_dir = path.relative(base_root, expected_dir);
      if (relative_dir !== "" && !relative_dir.startsWith("..") && !path.isAbsolute(relative_dir)) {
        candidates.add(this.normalize_path_key(relative_dir));
      }
    }
    return candidates.has(raw_normalized);
  }

  /**
   * 输出当前稳定虚拟 ID，写入前收窄扩展名。
   */
  private static build_virtual_id(source: PresetSource, file_name: string): string {
    if (!this.is_preset_file_name(file_name)) {
      throw new InternalInvariantError({
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
  private static is_preset_source(value: string): value is PresetSource {
    return value === "builtin" || value === "user";
  }

  /**
   * 质量规则预设只接受 JSON 文件名，避免把目录或提示词预设写进配置。
   */
  private static is_preset_file_name(value: string): boolean {
    return value !== "" && value.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION);
  }

  /**
   * 路径比较 key 兼容 Windows 大小写和分隔符差异。
   */
  private static normalize_path_key(value: string): string {
    const normalized = path.normalize(value).replace(/\\/g, "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  /**
   * 无法识别旧值时清空配置并记录 warning，避免运行态继续消费坏路径。
   */
  private static log_normalize_failure(
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
}
