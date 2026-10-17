import path from "node:path";
import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../../native/native-fs";
import { AppError, read_error_message } from "../../../../shared/error";
import { format_local_timestamp } from "../../../../shared/utils/format-local-timestamp";
import {
  assert_regular_path,
  assert_game_path_spellings,
  validate_game_path,
  is_game_backup_history_name,
  GAME_BACKUP_DIRECTORY,
} from "../../source-file-paths";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";

/** 普通文件优先，只有整批没有文件时才使用目录时间。 */
function backup_timestamp(entries: readonly string[], fs: NativeFs): string {
  let earliest_file = Infinity;
  let earliest_directory = Infinity;
  function visit(target: string): void {
    assert_regular_path(target, fs);
    const stat = fs.stat(target);
    const time = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs; // 不支持创建时间的文件系统返回 0。
    if (stat.isFile()) earliest_file = Math.min(earliest_file, time);
    else {
      earliest_directory = Math.min(earliest_directory, time);
      for (const entry of fs.read_dirents(target)) visit(path.join(target, entry.name));
    }
  }
  for (const target of entries) visit(target);
  return format_local_timestamp(
    new Date(Number.isFinite(earliest_file) ? earliest_file : earliest_directory).toISOString(),
  )!
    .replaceAll("-", "")
    .replace(" ", "_")
    .replaceAll(":", "");
}

/** 名称按大小写共同占位，只有排他创建的重名错误允许重试。 */
async function create_history(directory: string, timestamp: string, fs: NativeFs): Promise<string> {
  const occupied = new Set(fs.read_dirents(directory).map((entry) => entry.name.toLowerCase()));
  for (let suffix = 0; ; suffix++) {
    const name = GAME_BACKUP_DIRECTORY + "_" + timestamp + (suffix ? "_" + suffix : "");
    if (occupied.has(name.toLowerCase())) continue;
    const target = path.join(directory, name);
    try {
      await fs.make_dir_exclusive(target);
      return target;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue; // 并发占用同名目录时换名。
      throw error;
    }
  }
}

/** 调用方持有工程写入占用，失败时保留归档和部分新文件，供人工恢复及下次轮换。 */
export async function write_game_backup(
  root: string,
  files: ReadonlyMap<string, Uint8Array>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const names = [...files.keys()];
  assert_game_path_spellings(names);
  const paths = new ProjectAssetPathIndex();
  for (const name of names) {
    validate_game_path(name);
    paths.add(name);
  }
  signal?.throwIfAborted();
  const directory = path.join(root, GAME_BACKUP_DIRECTORY);
  let history: string | null = null;
  try {
    assert_regular_path(directory, fs);
    await fs.make_dir_async(directory);
    // 先固定旧内容，再创建本轮归档，历史目录始终留在同一层。
    const current: string[] = [];
    for (const entry of fs.read_dirents(directory)) {
      const target = path.join(directory, entry.name);
      assert_regular_path(target, fs);
      if (entry.isDirectory() && is_game_backup_history_name(entry.name)) continue;
      current.push(target);
    }
    if (current.length) {
      const timestamp = backup_timestamp(current, fs);
      signal?.throwIfAborted();
      history = await create_history(directory, timestamp, fs);
      for (const target of current) {
        await setImmediate(); // 让取消请求能在同步移动之间进入。
        signal?.throwIfAborted();
        fs.rename(target, path.join(history, path.basename(target)));
      }
    }
    // 全部旧内容移走后才能写入，移动失败不能混入本次字节。
    for (const [name, bytes] of files) {
      signal?.throwIfAborted();
      await fs.write_file(path.join(directory, name), bytes);
    }
    signal?.throwIfAborted();
  } catch (cause) {
    throw new AppError("file.io_failed", {
      cause,
      message:
        read_error_message(cause) +
        "\nGame backup: " +
        directory +
        (history ? "\nHistory: " + history : ""),
    });
  }
}
