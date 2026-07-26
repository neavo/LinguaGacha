import path from "node:path";

import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";

/**
 * 迁移目录中的指定扩展名文件；非目标文件留在原目录，避免误删用户材料。
 */
export function relocate_directory_items(
  log_manager: LogManager,
  source_dir: string,
  destination_dir: string,
  extension: string,
  boundaries: string[],
  native_fs: NativeFs = default_native_fs,
): void {
  if (!native_fs.exists(source_dir) || !native_fs.stat(source_dir).isDirectory()) {
    return;
  }
  native_fs.make_dir(destination_dir);
  const file_names = native_fs
    .read_dir_names(source_dir)
    .filter((file_name) => file_name.toLowerCase().endsWith(extension))
    .sort((left, right) => left.localeCompare(right));
  for (const file_name of file_names) {
    relocate_path_if_needed(
      log_manager,
      path.join(source_dir, file_name),
      path.join(destination_dir, file_name),
      native_fs,
    );
  }
  remove_empty_directories(source_dir, boundaries, native_fs);
}

/**
 * 目标已存在时保留当前事实并删除旧源；目标不存在时复制成功后再删除旧源。
 */
export function relocate_path_if_needed(
  log_manager: LogManager,
  source_path: string,
  destination_path: string,
  native_fs: NativeFs = default_native_fs,
): void {
  if (!native_fs.exists(source_path)) {
    return;
  }
  native_fs.make_dir(path.dirname(destination_path));
  try {
    if (!native_fs.exists(destination_path)) {
      native_fs.copy_entry(source_path, destination_path);
    }
    native_fs.remove(source_path, { recursive: true, force: true });
  } catch (error) {
    log_manager.warning(
      t_main_log("app.diagnostic.migration.path_failed", {
        SOURCE_PATH: source_path,
        DESTINATION_PATH: destination_path,
      }),
      { source: "migration", error },
    );
  }
}

/**
 * 迁移完成后只向上清理空目录，遇到应用根或数据根边界立即停止。
 */
function remove_empty_directories(
  directory: string,
  boundaries: string[],
  native_fs: NativeFs,
): void {
  const boundary_keys = boundaries.map((boundary) =>
    native_fs.to_identity_path(boundary).replace(/\\/g, "/"),
  );
  let current = path.resolve(directory);
  while (!boundary_keys.includes(native_fs.to_identity_path(current).replace(/\\/g, "/"))) {
    if (!native_fs.exists(current) || !native_fs.stat(current).isDirectory()) {
      return;
    }
    try {
      native_fs.remove_empty_dir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
