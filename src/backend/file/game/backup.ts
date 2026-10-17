import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import {
  assert_regular_path,
  assert_game_path_spellings,
  validate_game_path,
  GAME_BACKUP_DIRECTORY,
  GAME_WORKSPACE_DIRECTORY,
} from "../source-file-paths";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { is_json_record } from "../../../domain/json";

const LEGACY_DIRECTORIES = [".linguagacha-backup", ".lg-original"] as const;
const BACKUP_MARKER = ".linguagacha-backup.json";
const BACKUP_VERSION = 1;
const BACKUP_ENGINES = new Set(["mv", "mz", "xp", "vx", "ace", "wolf3"]);

/** 来源识别只读取标记身份，原稿覆盖仍由正式备份校验负责。 */
export function read_game_backup_engine(directory: string, fs: NativeFs): string | null {
  const marker = path.join(directory, BACKUP_MARKER);
  let text: string;
  try {
    if (!fs.stat(marker).isFile()) return null;
    text = fs.read_text_file(marker);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; // 未完成备份尚无标记。
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null; // 非 JSON 内容不符合标记格式。
    throw error;
  }
  return is_json_record(value) &&
    value["version"] === BACKUP_VERSION &&
    typeof value["engine"] === "string" &&
    BACKUP_ENGINES.has(value["engine"])
    ? value["engine"]
    : null;
}

/** 临时目录标记未完成操作，后续写入须保留恢复材料。 */
function check_backup_directory(root: string, fs: NativeFs): string {
  assert_regular_path(root, fs);
  for (const name of LEGACY_DIRECTORIES) {
    const legacy = path.join(root, name);
    assert_regular_path(legacy, fs);
    if (fs.exists(legacy))
      throw new Error("Handle legacy game backup before continuing: " + legacy);
  }
  const directory = path.join(root, GAME_BACKUP_DIRECTORY);
  assert_regular_path(directory, fs);
  if (fs.exists(directory)) {
    if (!fs.stat(directory).isDirectory()) throw new Error("Invalid game backup: " + directory);
    const temporary = path.join(directory, GAME_WORKSPACE_DIRECTORY);
    assert_regular_path(temporary, fs);
    if (fs.exists(temporary))
      throw new Error("Unfinished game operation; recovery files: " + temporary);
    if (fs.read_dirents(directory).length && !fs.exists(path.join(directory, BACKUP_MARKER)))
      throw new Error("Invalid game backup: " + directory);
  }
  return directory;
}

/** 调用方持有工程写入占用，独占创建防止并发调用共用恢复材料。 */
export async function create_game_workspace(root: string, fs: NativeFs): Promise<string> {
  const directory = check_backup_directory(root, fs);
  if (fs.exists(directory) && fs.read_dirents(directory).length)
    throw new Error("Game conversion conflicts with existing backup: " + directory);
  await fs.make_dir_async(directory);
  const workspace = path.join(directory, GAME_WORKSPACE_DIRECTORY);
  await fs.make_dir_exclusive(workspace);
  return workspace;
}

/** 首次备份不可补写，每次导入都确认当前原稿路径有安全的普通文件覆盖。 */
export function check_game_backup(
  root: string,
  engine: string,
  names: readonly string[],
  fs: NativeFs,
): boolean {
  const directory = check_backup_directory(root, fs);
  if (!fs.exists(directory) || !fs.read_dirents(directory).length) return false;
  const marker = path.join(directory, BACKUP_MARKER);
  assert_regular_path(marker, fs);
  if (read_game_backup_engine(directory, fs) !== engine)
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

/** 使用与容器相同的字节，最后发布标记以确认备份完整。 */
export async function write_game_backup(
  root: string,
  engine: string,
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
  const workspace = await create_game_workspace(root, fs); // 只接收空备份目录，已有原稿统一由入口保护。
  const staging = path.join(workspace, "stage");
  const directory = path.join(root, GAME_BACKUP_DIRECTORY);
  const published: string[] = []; // 发布顶层条目便于失败时连同新建目录一起撤销。
  try {
    await fs.make_dir_exclusive(staging);
    for (const [name, bytes] of files) {
      signal?.throwIfAborted();
      await fs.write_file(path.join(staging, name), bytes);
    }
    await fs.write_file(
      path.join(staging, BACKUP_MARKER),
      JSON.stringify({ version: BACKUP_VERSION, engine }),
    );
    for (const entry of fs.read_dirents(staging)) {
      if (entry.name === BACKUP_MARKER) continue;
      signal?.throwIfAborted();
      const destination = path.join(directory, entry.name);
      assert_regular_path(destination, fs);
      if (fs.exists(destination)) throw new Error("Game backup already exists: " + destination);
      fs.rename(path.join(staging, entry.name), destination);
      published.push(destination);
    }
    signal?.throwIfAborted();
    fs.rename(path.join(staging, BACKUP_MARKER), path.join(directory, BACKUP_MARKER));
  } catch (cause) {
    try {
      for (const target of published.reverse()) await fs.remove_async(target, { recursive: true });
      await fs.remove_async(workspace, { recursive: true });
    } catch (error) {
      throw new AppError("file.io_failed", {
        cause,
        message:
          read_error_message(cause) +
          "\nCleanup failed; recovery files: " +
          workspace +
          "\n" +
          read_error_message(error),
      });
    }
    throw cause;
  }
  // 标记发布后备份已提交，清理失败只保留现场并报告，不能删除完整原稿。
  try {
    await fs.remove_async(workspace, { recursive: true });
  } catch (cause) {
    throw new AppError("file.io_failed", {
      cause,
      message:
        "Game backup committed. Cleanup failed: " + workspace + "\n" + read_error_message(cause),
    });
  }
}
