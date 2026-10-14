import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { assert_regular_path, GAME_BACKUP_DIRECTORY, validate_game_path } from "./rpgmaker-prepare";

const BACKUP_MARKER = ".linguagacha-backup.json";
const BACKUP_VERSION = 1;

/** 首次备份不可补写，每次导入都确认当前原稿路径有安全的普通文件覆盖。 */
export function check_game_backup(
  root: string,
  engine: string,
  names: readonly string[],
  fs: NativeFs,
): boolean {
  const directory = path.join(root, GAME_BACKUP_DIRECTORY);
  assert_regular_path(directory, fs);
  if (!fs.exists(directory)) return false;
  if (!fs.stat(directory).isDirectory()) throw new Error("Invalid game backup: " + directory);
  const marker = path.join(directory, BACKUP_MARKER);
  assert_regular_path(marker, fs);
  const expected = JSON.stringify({ version: BACKUP_VERSION, engine });
  if (!fs.exists(marker) || !fs.stat(marker).isFile() || fs.read_text_file(marker) !== expected)
    throw new Error("Invalid game backup: " + directory);
  for (const name of names) {
    validate_game_path(name);
    const target = path.join(directory, name);
    try {
      assert_regular_path(target, fs);
      if (!fs.exists(target)) throw new Error("Missing backup file");
      if (!fs.stat(target).isFile()) throw new Error("Backup path is not a regular file");
    } catch (cause) {
      throw new Error(
        "Game backup coverage conflict: " +
          target +
          "\n" +
          read_error_message(cause) +
          "\nUse a separate game directory to establish a new original baseline.",
        { cause },
      );
    }
  }
  return true;
}

/** 使用与容器相同的字节，临时目录完整写入后才发布首次备份。 */
export async function write_game_backup(
  root: string,
  engine: string,
  files: ReadonlyMap<string, Uint8Array>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const staging = path.join(root, GAME_BACKUP_DIRECTORY + "-" + randomUUID());
  await fs.make_dir_exclusive(staging);
  try {
    for (const [name, bytes] of files) {
      signal?.throwIfAborted();
      await fs.write_file(path.join(staging, name), bytes);
    }
    await fs.write_file(
      path.join(staging, BACKUP_MARKER),
      JSON.stringify({ version: BACKUP_VERSION, engine }),
    );
    signal?.throwIfAborted();
    const destination = path.join(root, GAME_BACKUP_DIRECTORY);
    assert_regular_path(destination, fs);
    if (fs.exists(destination)) throw new Error("Game backup already exists: " + destination);
    fs.rename(staging, destination);
  } catch (cause) {
    try {
      await fs.remove_async(staging, { recursive: true });
    } catch (error) {
      throw new AppError("file.io_failed", {
        cause,
        message:
          read_error_message(cause) +
          "\nCleanup failed: " +
          staging +
          "\n" +
          read_error_message(error),
      });
    }
    throw cause;
  }
}
