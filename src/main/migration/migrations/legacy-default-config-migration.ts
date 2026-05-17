import path from "node:path";

import { default_native_fs } from "../../../native/platform/native-fs";
import type { MigrationDescriptor, StartupMigrationContext } from "../migration-types";

// 旧默认配置只围绕这两个固定资源名迁移，当前目标由 AppPathService 提供。
const CONFIG_FILE_NAME = "config.json";
const RESOURCE_DIR_NAME = "resource";

/**
 * 迁移背景：
 * 旧版默认配置曾按运行形态分散在 `dataRoot/config.json`、`resource/config.json`
 * 或更早的 `appRoot/config.json`。当前配置唯一事实源是 `userdata/config.json`，
 * `AppSettingService` 启动后不再读取旧位置。
 *
 * 生效场景：
 * Core 启动且 `userdata/config.json` 尚不存在时，按旧读取优先级复制第一份存在的配置。
 *
 * 不处理范围：
 * 当前配置已存在时绝不覆盖；损坏 JSON 不在这里校验，由设置读取层按当前规则归一。
 */
export const legacy_default_config_migration: MigrationDescriptor = {
  id: "legacy-default-config",
  order: 100,
  /**
   * 只在当前配置缺失时复制旧配置，确保用户已迁入 userdata 的设置不被旧默认值覆盖。
   */
  run_startup(context: StartupMigrationContext): void {
    const target_path = context.paths.get_config_path();
    if (default_native_fs.exists(target_path)) {
      return;
    }
    default_native_fs.make_dir(path.dirname(target_path));
    for (const source_path of get_legacy_default_config_paths(context)) {
      if (!default_native_fs.exists(source_path) || !default_native_fs.stat(source_path).isFile()) {
        continue;
      }
      default_native_fs.copy_file(source_path, target_path);
      return;
    }
  },
};

/**
 * 旧默认配置候选顺序复刻 Python 版读取优先级，避免升级后设置来源翻转。
 */
export function get_legacy_default_config_paths(context: StartupMigrationContext): string[] {
  const data_root = context.paths.get_data_root();
  const app_root = context.paths.get_app_root();
  const resource_config_path = path.join(app_root, RESOURCE_DIR_NAME, CONFIG_FILE_NAME);
  const data_config_path = path.join(data_root, CONFIG_FILE_NAME);
  const app_config_path = path.join(app_root, CONFIG_FILE_NAME);
  const candidate_paths = is_same_path(data_root, app_root)
    ? [resource_config_path, data_config_path, app_config_path]
    : [data_config_path, resource_config_path, app_config_path];
  return unique_paths(candidate_paths);
}

/**
 * appRoot 与 dataRoot 可能相同，候选路径去重后才能稳定按优先级尝试。
 */
function unique_paths(paths: string[]): string[] {
  const unique_paths: string[] = [];
  const seen_paths = new Set<string>();
  for (const candidate_path of paths) {
    const key = normalize_path_key(candidate_path);
    if (seen_paths.has(key)) {
      continue;
    }
    seen_paths.add(key);
    unique_paths.push(candidate_path);
  }
  return unique_paths;
}

/**
 * 路径相等判断统一走 normalize key，避免 Windows 大小写与分隔符造成重复候选。
 */
function is_same_path(left: string, right: string): boolean {
  return normalize_path_key(left) === normalize_path_key(right);
}

/**
 * 生成跨平台路径比较 key；这里不 resolve，保留候选路径本身的旧读取语义。
 */
function normalize_path_key(value: string): string {
  const normalized = path.normalize(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
