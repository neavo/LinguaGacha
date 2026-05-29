import path from "node:path";

import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import { NativeFs, default_native_fs } from "../../native/native-fs";

/**
 * 启动期历史文件迁移只使用 copy-delete 语义：先把旧源完整复制到当前权威位置，
 * 成功后再删除旧源。这样同盘、跨盘、只读安装目录迁出都走同一条路径，
 * 不把 `rename` 的平台差异泄露给具体迁移点。
 */
export class PathRelocation {
  private readonly log_manager: LogManager; // log_manager 只记录迁移失败诊断
  private readonly native_fs: NativeFs; // native_fs 统一历史文件复制、删除和目录扫描策略

  /**
   * log_manager 只记录迁移失败诊断；调用方仍继续启动，避免旧文件问题阻塞应用。
   */
  public constructor(log_manager: LogManager, native_fs: NativeFs = default_native_fs) {
    this.log_manager = log_manager;
    this.native_fs = native_fs;
  }

  /**
   * 迁移目录中的指定扩展名文件，非目标文件留在原目录，避免误删用户材料。
   */
  public relocate_directory_items(
    source_dir: string,
    destination_dir: string,
    extension: string,
    boundaries: string[],
  ): void {
    if (!this.native_fs.exists(source_dir) || !this.native_fs.stat(source_dir).isDirectory()) {
      return;
    }
    this.native_fs.make_dir(destination_dir);
    const file_names = this.native_fs
      .read_dir_names(source_dir)
      .filter((file_name) => file_name.toLowerCase().endsWith(extension))
      .sort((left, right) => left.localeCompare(right));
    for (const file_name of file_names) {
      this.relocate_path_if_needed(
        path.join(source_dir, file_name),
        path.join(destination_dir, file_name),
      );
    }
    this.remove_empty_directories(source_dir, boundaries);
  }

  /**
   * 目标已存在时保留当前事实并删除旧源；目标不存在时复制成功后删除旧源。
   */
  public relocate_path_if_needed(source_path: string, destination_path: string): void {
    if (!this.native_fs.exists(source_path)) {
      return;
    }
    this.native_fs.make_dir(path.dirname(destination_path));
    try {
      if (!this.native_fs.exists(destination_path)) {
        this.copy_path(source_path, destination_path);
      }
      this.remove_path(source_path);
    } catch (error) {
      this.log_manager.warning(
        t_main_log("app.diagnostic.migration.path_failed", {
          SOURCE_PATH: source_path,
          DESTINATION_PATH: destination_path,
        }),
        {
          source: "migration",
          error,
        },
      );
    }
  }

  /**
   * 迁移完成后只清理空目录，遇到当前应用根或数据根立即停止。
   */
  private remove_empty_directories(directory: string, boundaries: string[]): void {
    const normalized_boundaries = boundaries.map((boundary) => this.normalize_path_key(boundary));
    let current = path.resolve(directory);
    while (!normalized_boundaries.includes(this.normalize_path_key(current))) {
      if (!this.native_fs.exists(current) || !this.native_fs.stat(current).isDirectory()) {
        return;
      }
      try {
        this.native_fs.remove_empty_dir(current);
      } catch {
        return;
      }
      current = path.dirname(current);
    }
  }

  /**
   * 目录复制和文件复制走同一个入口，保证目标不存在时先完整复制再删除源。
   */
  private copy_path(source_path: string, destination_path: string): void {
    this.native_fs.copy_entry(source_path, destination_path);
  }

  /**
   * 清理旧源统一 force 删除；只有复制成功或目标已存在时才会进入这里。
   */
  private remove_path(target_path: string): void {
    this.native_fs.remove(target_path, { recursive: true, force: true });
  }

  /**
   * 边界比较使用绝对路径 key，Windows 下额外做大小写归一。
   */
  private normalize_path_key(value: string): string {
    return this.native_fs.to_identity_path(value).replace(/\\/g, "/");
  }
}
