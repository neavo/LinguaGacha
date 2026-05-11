import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import type { LogManager } from "../log/log-manager";
import type { AppPathService } from "../service/path-service";
import { JsonTool } from "../../shared/utils/json-tool";

type ConfigRecord = Record<string, ApiJsonValue>;
type PresetSource = "builtin" | "user";

// 启动期迁移只处理历史固定落点，当前写入口仍由 AppPathService 给出。
const CONFIG_FILE_NAME = "config.json";
const RESOURCE_DIR_NAME = "resource";
const PRESET_DIR_NAME = "preset";
const USER_DIR_NAME = "user";
const CUSTOM_PROMPT_DIR_NAME = "custom_prompt";
// 提示词和质量规则预设扩展名不同，迁移时必须分开过滤。
const PROMPT_PRESET_EXTENSION = ".txt";
const QUALITY_RULE_PRESET_EXTENSION = ".json";
// 历史内置资源目录只出现过中英文两层。
const LANGUAGE_DIR_NAMES = ["zh", "en"] as const;
// 只有质量规则默认预设经历过旧路径到虚拟 ID 的配置迁移。
const QUALITY_RULE_PRESET_CONFIG_KEYS = {
  glossary_default_preset: "glossary",
  text_preserve_default_preset: "text_preserve",
  pre_translation_replacement_default_preset: "pre_translation_replacement",
  post_translation_replacement_default_preset: "post_translation_replacement",
} as const;
const QUALITY_RULE_PRESET_DIR_NAMES = Object.values(QUALITY_RULE_PRESET_CONFIG_KEYS);

/**
 * 统一承接启动期 userdata 与旧预设布局迁移。
 */
export class UserDataMigrationService {
  private readonly paths: AppPathService;
  private readonly log_manager: LogManager;

  /**
   * 注入当前路径权威和日志出口，避免启动迁移自行猜测运行态根目录。
   */
  public constructor(paths: AppPathService, log_manager: LogManager) {
    this.paths = paths;
    this.log_manager = log_manager;
  }

  /**
   * 启动期迁移入口必须先于 ConfigService 读取配置执行。
   */
  public run_startup_migrations(): void {
    this.migrate_default_config_if_needed();
    this.migrate_prompt_user_presets();
    this.migrate_quality_rule_user_presets();
    this.migrate_quality_rule_builtin_layout();
    this.normalize_default_preset_config_values();
  }

  /**
   * 把旧默认配置复制到当前 userdata/config.json，避免后续读取旧位置。
   */
  public migrate_default_config_if_needed(): void {
    const target_path = this.paths.get_config_path();
    if (fs.existsSync(target_path)) {
      return;
    }
    fs.mkdirSync(path.dirname(target_path), { recursive: true });
    for (const source_path of this.get_legacy_default_config_paths()) {
      if (!fs.existsSync(source_path) || !fs.statSync(source_path).isFile()) {
        continue;
      }
      fs.copyFileSync(source_path, target_path);
      return;
    }
  }

  /**
   * 把旧版翻译提示词用户预设迁到当前 userdata 目录。
   */
  public migrate_prompt_user_presets(): void {
    const destination_dir = this.paths.get_prompt_user_preset_dir("translation");
    fs.mkdirSync(destination_dir, { recursive: true });
    for (const source_dir of this.get_legacy_prompt_user_preset_dirs()) {
      this.move_directory_items(source_dir, destination_dir, PROMPT_PRESET_EXTENSION);
    }
  }

  /**
   * 把旧版质量规则用户预设迁到当前 userdata 目录。
   */
  public migrate_quality_rule_user_presets(): void {
    for (const preset_dir_name of QUALITY_RULE_PRESET_DIR_NAMES) {
      const source_dir = this.get_quality_rule_legacy_user_preset_dir(preset_dir_name);
      const destination_dir = this.paths.get_quality_rule_user_preset_dir(preset_dir_name);
      fs.mkdirSync(destination_dir, { recursive: true });
      this.move_directory_items(source_dir, destination_dir, QUALITY_RULE_PRESET_EXTENSION);
    }
  }

  /**
   * 把旧版质量规则内置预设目录迁到当前 resource/<type>/preset 结构。
   */
  public migrate_quality_rule_builtin_layout(): void {
    for (const preset_dir_name of QUALITY_RULE_PRESET_DIR_NAMES) {
      const destination_dir = this.paths.get_quality_rule_builtin_preset_dir(preset_dir_name);
      fs.mkdirSync(destination_dir, { recursive: true });
      for (const source_dir of this.iter_quality_rule_builtin_source_dirs(preset_dir_name)) {
        this.move_directory_items(source_dir, destination_dir, QUALITY_RULE_PRESET_EXTENSION);
      }
    }
  }

  /**
   * 把默认配置里的旧预设路径归一为当前虚拟 ID。
   */
  public normalize_default_preset_config_values(): void {
    const config_path = this.paths.get_config_path();
    if (!fs.existsSync(config_path) || !fs.statSync(config_path).isFile()) {
      return;
    }

    try {
      const config_data = JsonTool.parseStrict(fs.readFileSync(config_path)) as unknown;
      if (typeof config_data !== "object" || config_data === null || Array.isArray(config_data)) {
        return;
      }
      const [normalized_config, changed] = this.normalize_config_payload(
        config_data as ConfigRecord,
      );
      if (!changed) {
        return;
      }
      fs.writeFileSync(
        config_path,
        JsonTool.stringifyStrict(normalized_config, { indent: 4 }),
        "utf-8",
      );
    } catch (error) {
      this.log_warning(`归一化默认预设配置失败：${config_path}`, error);
    }
  }

  /**
   * 把旧版默认预设路径归一化成新的虚拟 ID。
   */
  public normalize_config_payload(config_data: ConfigRecord): [ConfigRecord, boolean] {
    const normalized = { ...config_data };
    let changed = false;

    for (const [config_key, preset_dir_name] of Object.entries(QUALITY_RULE_PRESET_CONFIG_KEYS)) {
      const current_value = normalized[config_key];
      if (typeof current_value !== "string" || current_value === "") {
        continue;
      }

      const resolved_value = this.normalize_quality_rule_default_preset_value(
        preset_dir_name,
        current_value,
      );
      if (resolved_value !== current_value) {
        normalized[config_key] = resolved_value;
        changed = true;
      }
    }

    return [normalized, changed];
  }

  /**
   * 把旧路径或旧三段式 builtin 标识统一转换成稳定的虚拟 ID。
   */
  public normalize_quality_rule_default_preset_value(
    preset_dir_name: string,
    value: string,
  ): string {
    if (value === "") {
      return value;
    }

    const virtual_id = this.try_normalize_quality_rule_virtual_id(value);
    if (virtual_id !== null) {
      return virtual_id;
    }

    const file_name = path.basename(value);
    if (!file_name.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION)) {
      this.log_warning(`归一化默认预设值失败：${preset_dir_name} -> ${value}`, undefined);
      return "";
    }

    // 旧配置里保存的是路径而非来源标记，只能通过命中的历史目录反推出来源。
    const resolved_source = this.resolve_quality_rule_source_from_path(
      preset_dir_name,
      path.dirname(value),
    );
    if (resolved_source === null) {
      this.log_warning(`归一化默认预设值失败：${preset_dir_name} -> ${value}`, undefined);
      return "";
    }

    return this.build_virtual_id(resolved_source, file_name, QUALITY_RULE_PRESET_EXTENSION);
  }

  /**
   * 旧默认配置候选顺序复刻 Python 版读取优先级，避免升级后设置来源翻转。
   */
  private get_legacy_default_config_paths(): string[] {
    const data_root = this.paths.get_data_root();
    const app_root = this.paths.get_app_root();
    const resource_config_path = path.join(app_root, RESOURCE_DIR_NAME, CONFIG_FILE_NAME);
    const data_config_path = path.join(data_root, CONFIG_FILE_NAME);
    const app_config_path = path.join(app_root, CONFIG_FILE_NAME);
    // 便携或只读安装场景优先沿用 DATA_ROOT/config.json，普通桌面场景优先 resource/config.json。
    const candidate_paths = this.is_same_path(data_root, app_root)
      ? [resource_config_path, data_config_path, app_config_path]
      : [data_config_path, resource_config_path, app_config_path];
    return this.unique_paths(candidate_paths);
  }

  /**
   * 旧翻译提示词用户预设位于 resource/preset/custom_prompt/user/<lang>。
   */
  private get_legacy_prompt_user_preset_dirs(): string[] {
    return LANGUAGE_DIR_NAMES.map((language) =>
      path.join(
        this.paths.get_app_root(),
        RESOURCE_DIR_NAME,
        PRESET_DIR_NAME,
        CUSTOM_PROMPT_DIR_NAME,
        USER_DIR_NAME,
        language,
      ),
    );
  }

  /**
   * 旧质量规则用户预设位于 resource/preset/<type>/user。
   */
  private get_quality_rule_legacy_user_preset_dir(preset_dir_name: string): string {
    return path.join(
      this.paths.get_app_root(),
      RESOURCE_DIR_NAME,
      PRESET_DIR_NAME,
      preset_dir_name,
      USER_DIR_NAME,
    );
  }

  /**
   * 枚举旧 builtin 两种布局：resource/<type>/preset/<lang> 与 resource/preset/<type>/<lang>。
   */
  private iter_quality_rule_builtin_source_dirs(preset_dir_name: string): string[] {
    const directories: string[] = [];
    for (const language of LANGUAGE_DIR_NAMES) {
      directories.push(
        path.join(
          this.paths.get_app_root(),
          RESOURCE_DIR_NAME,
          preset_dir_name,
          PRESET_DIR_NAME,
          language,
        ),
      );
      directories.push(
        path.join(
          this.paths.get_app_root(),
          RESOURCE_DIR_NAME,
          PRESET_DIR_NAME,
          preset_dir_name,
          language,
        ),
      );
    }
    return directories;
  }

  /**
   * 只迁移目标扩展名文件，非预设文件留在原目录避免误删用户材料。
   */
  private move_directory_items(
    source_dir: string,
    destination_dir: string,
    extension: string,
  ): void {
    if (!fs.existsSync(source_dir) || !fs.statSync(source_dir).isDirectory()) {
      return;
    }

    const file_names = fs
      .readdirSync(source_dir)
      .filter((file_name) => file_name.toLowerCase().endsWith(extension))
      .sort((left, right) => left.localeCompare(right));
    for (const file_name of file_names) {
      this.move_path_if_needed(
        path.join(source_dir, file_name),
        path.join(destination_dir, file_name),
      );
    }

    this.remove_empty_directories(source_dir);
  }

  /**
   * 目标已存在时保留当前文件并删除旧文件，保证迁移幂等。
   */
  private move_path_if_needed(source_path: string, destination_path: string): void {
    if (!fs.existsSync(source_path)) {
      return;
    }

    fs.mkdirSync(path.dirname(destination_path), { recursive: true });
    try {
      if (fs.existsSync(destination_path)) {
        this.remove_path(source_path);
      } else {
        fs.renameSync(source_path, destination_path);
      }
    } catch (error) {
      this.log_warning(`迁移路径失败：${source_path} -> ${destination_path}`, error);
    }
  }

  /**
   * 迁移后只向上清理空目录，遇到 app/data 根立即停止。
   */
  private remove_empty_directories(directory: string): void {
    const boundaries = [this.paths.get_app_root(), this.paths.get_data_root()];
    let current = path.resolve(directory);
    while (!boundaries.some((boundary) => this.is_same_path(current, boundary))) {
      if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
        return;
      }
      try {
        fs.rmdirSync(current);
      } catch {
        return;
      }
      current = path.dirname(current);
    }
  }

  /**
   * 删除旧重复路径时同时兼容文件和目录。
   */
  private remove_path(target_path: string): void {
    fs.rmSync(target_path, { recursive: true, force: true });
  }

  /**
   * 兼容当前两段式和旧 builtin:<lang>:file.json 三段式虚拟 ID。
   */
  private try_normalize_quality_rule_virtual_id(value: string): string | null {
    const parts = value.split(":");
    if (parts.length === 2) {
      const [source, file_name] = parts;
      if (
        this.is_preset_source(source) &&
        file_name.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION)
      ) {
        return this.build_virtual_id(source, file_name, QUALITY_RULE_PRESET_EXTENSION);
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
        file_name.toLowerCase().endsWith(QUALITY_RULE_PRESET_EXTENSION)
      ) {
        return this.build_virtual_id(source, file_name, QUALITY_RULE_PRESET_EXTENSION);
      }
    }
    return null;
  }

  /**
   * 通过旧路径所在目录判断默认预设来源，最终统一收敛为 user/builtin。
   */
  private resolve_quality_rule_source_from_path(
    preset_dir_name: string,
    raw_dir: string,
  ): PresetSource | null {
    const user_directories = [
      this.paths.get_quality_rule_user_preset_dir(preset_dir_name),
      this.get_quality_rule_legacy_user_preset_dir(preset_dir_name),
    ];
    if (user_directories.some((directory) => this.is_same_directory(raw_dir, directory))) {
      return "user";
    }

    const builtin_directories = [
      this.paths.get_quality_rule_builtin_preset_dir(preset_dir_name),
      ...this.iter_quality_rule_builtin_source_dirs(preset_dir_name),
    ];
    if (builtin_directories.some((directory) => this.is_same_directory(raw_dir, directory))) {
      return "builtin";
    }

    return null;
  }

  /**
   * 同时接受绝对路径和相对 app/data 根的旧配置值。
   */
  private is_same_directory(raw_dir: string, expected_dir: string): boolean {
    const raw_normalized = this.normalize_path_key(raw_dir);
    const candidates = new Set([this.normalize_path_key(expected_dir)]);
    for (const base_root of [this.paths.get_app_root(), this.paths.get_data_root()]) {
      const relative_dir = path.relative(base_root, expected_dir);
      if (relative_dir !== "" && !relative_dir.startsWith("..") && !path.isAbsolute(relative_dir)) {
        candidates.add(this.normalize_path_key(relative_dir));
      }
    }
    return candidates.has(raw_normalized);
  }

  /**
   * 输出当前稳定虚拟 ID，并在写入前收窄文件扩展名。
   */
  private build_virtual_id(source: PresetSource, file_name: string, extension: string): string {
    if (!file_name || !file_name.toLowerCase().endsWith(extension)) {
      throw new Error(`无效预设文件名：${file_name}`);
    }
    return `${source}:${file_name}`;
  }

  /**
   * 把字符串来源收窄到当前支持的预设来源集合。
   */
  private is_preset_source(value: string): value is PresetSource {
    return value === "builtin" || value === "user";
  }

  /**
   * 候选旧路径去重后再按优先级尝试，避免 appRoot=dataRoot 时重复复制。
   */
  private unique_paths(paths: string[]): string[] {
    const unique_paths: string[] = [];
    const seen_paths = new Set<string>();
    for (const candidate_path of paths) {
      const key = this.normalize_path_key(candidate_path);
      if (seen_paths.has(key)) {
        continue;
      }
      seen_paths.add(key);
      unique_paths.push(candidate_path);
    }
    return unique_paths;
  }

  /**
   * 路径比较统一走同一个 key，兼容 Windows 大小写和分隔符差异。
   */
  private is_same_path(left: string, right: string): boolean {
    return this.normalize_path_key(left) === this.normalize_path_key(right);
  }

  /**
   * 生成跨平台路径比较 key，Windows 下额外大小写归一。
   */
  private normalize_path_key(value: string): string {
    const normalized = path.normalize(value).replace(/\\/g, "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  /**
   * 迁移失败只记录 warning 并继续启动，保留原始错误上下文供排查。
   */
  private log_warning(message: string, error: unknown): void {
    this.log_manager.warning(message, {
      source: "migration",
      error_message: error instanceof Error ? error.message : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
