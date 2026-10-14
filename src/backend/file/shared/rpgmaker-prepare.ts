import { setImmediate } from "node:timers/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { validate_zip_member_path } from "./zip-members";

export const GAME_BACKUP_DIRECTORY = ".linguagacha-backup";
export const GAME_ORIGINAL_DIRECTORY = ".lg-original";
export const GAME_STAGING_PREFIX = ".linguagacha-game-";
const GAME_ROLLBACK_PREFIX = ".linguagacha-rollback-";
export type GamePreparation = Readonly<{
  writes: readonly string[];
  removes?: readonly string[];
  originals?: readonly string[];
}>;

/** 正式目录的唯一写入口，调用方持有写入占用直到 worker、回滚和清理结束。 */
export async function prepare_game_directory(
  root: string,
  fs: NativeFs,
  stage: (directory: string) => Promise<GamePreparation>,
  signal?: AbortSignal,
): Promise<void> {
  let staging: string | null = null;
  let rollback: string | null = null;
  let original_staging: string | null = null;
  const recovery_files = new Map<string, string>(); // 每个旧文件只保存一份，回滚不区分副本目录。
  const changed: string[] = []; // 包括部分写入失败的目标，按逆序回滚。
  const created_directories: string[] = []; // 仅移除本次创建的空目录。
  const checkpoint = async () => {
    // 同步复制之间让出事件循环，使取消请求能进入。
    await setImmediate();
    signal?.throwIfAborted();
  };
  try {
    signal?.throwIfAborted();
    assert_regular_path(root, fs);
    staging = path.join(root, GAME_STAGING_PREFIX + randomUUID());
    await fs.make_dir_exclusive(staging);
    const plan = await stage(staging);
    signal?.throwIfAborted();
    const targets = [...plan.writes, ...(plan.removes ?? [])];
    assert_game_path_spellings(targets);
    const paths = new ProjectAssetPathIndex();
    const rollback_files = new Set<string>();
    const directory_entries = new Map<string, Map<string, string | null>>();
    for (const name of targets) {
      await checkpoint();
      validate_game_path(name);
      paths.add(name);
      let parent = root;
      for (const part of name.split("/")) {
        if (fs.exists(parent)) {
          let entries = directory_entries.get(parent);
          if (!entries) {
            entries = new Map();
            for (const entry of fs.read_dirents(parent)) {
              const key = entry.name.toLowerCase();
              entries.set(key, entries.has(key) ? null : entry.name); // 保留磁盘上多种拼写的冲突。
            }
            directory_entries.set(parent, entries);
          }
          const actual = entries.get(part.toLowerCase());
          if (actual !== undefined && actual !== part)
            throw new Error("Game path differs only by case: " + name);
        }
        parent = path.join(parent, part);
      }
      const target = path.join(root, name);
      assert_regular_path(target, fs);
      if (fs.exists(target)) {
        if (!fs.stat(target).isFile())
          throw new Error("Game file conflicts with directory: " + name);
        rollback_files.add(name);
      }
    }
    for (const name of plan.writes) {
      assert_regular_path(path.join(staging, name), fs);
      if (!fs.stat(path.join(staging, name)).isFile())
        throw new Error("Missing staged file: " + name);
    }
    const originals = new Set(plan.originals);
    for (const name of originals) {
      if (!rollback_files.has(name))
        throw new Error("Original archive is not an existing conversion target: " + name);
    }
    if (originals.size) {
      for (const directory of [GAME_BACKUP_DIRECTORY, GAME_ORIGINAL_DIRECTORY]) {
        const target = path.join(root, directory);
        assert_regular_path(target, fs);
        if (fs.exists(target))
          throw new Error("Game conversion conflicts with existing backup: " + target);
      }
      original_staging = path.join(root, GAME_ORIGINAL_DIRECTORY + "-" + randomUUID());
      await fs.make_dir_exclusive(original_staging);
    }
    rollback = path.join(root, GAME_ROLLBACK_PREFIX + randomUUID());
    await fs.make_dir_exclusive(rollback);
    for (const name of rollback_files) {
      await checkpoint();
      const destination = path.join(originals.has(name) ? original_staging! : rollback, name);
      fs.copy_file(path.join(root, name), destination);
      recovery_files.set(name, destination);
    }
    for (const name of plan.writes) {
      await checkpoint();
      const destination = path.join(root, name);
      assert_regular_path(destination, fs);
      const missing: string[] = [];
      for (
        let directory = path.dirname(destination);
        !fs.exists(directory);
        directory = path.dirname(directory)
      )
        missing.push(directory);
      for (const directory of missing.reverse()) {
        await fs.make_dir_exclusive(directory);
        created_directories.push(directory);
      }
      changed.push(name);
      fs.copy_file_atomic(path.join(staging, name), destination);
    }
    for (const name of plan.removes ?? []) {
      await checkpoint();
      changed.push(name);
      fs.unlink(path.join(root, name));
    }
    signal?.throwIfAborted();
    if (original_staging) {
      const destination = path.join(root, GAME_ORIGINAL_DIRECTORY);
      assert_regular_path(destination, fs);
      if (fs.exists(destination))
        throw new Error("Original game archive already exists: " + destination);
      fs.rename(original_staging, destination);
      original_staging = null;
    }
    // 此处完成来源转换；后续清理失败不能撤销已提交的游戏。
  } catch (cause) {
    const recovery_errors: string[] = [];
    for (const name of changed.reverse()) {
      try {
        assert_regular_path(path.join(root, name), fs);
        const saved = recovery_files.get(name);
        if (saved) fs.copy_file_atomic(saved, path.join(root, name));
        else fs.unlink(path.join(root, name), { force: true });
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    for (const directory of created_directories.reverse()) {
      try {
        fs.remove_empty_dir(directory);
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    if (!recovery_errors.length) {
      for (const directory of [staging, rollback, original_staging]) {
        if (!directory) continue;
        try {
          await fs.remove_async(directory, { recursive: true });
        } catch (error) {
          recovery_errors.push(directory + ": " + read_error_message(error));
        }
      }
    }
    throw new AppError("file.io_failed", {
      cause,
      message: [
        read_error_message(cause),
        rollback && fs.exists(rollback) ? "Rollback: " + rollback : "",
        recovery_errors.length
          ? "Recovery or cleanup failed: " + recovery_errors.join("; ")
          : "Original game files retained or restored.",
        staging && fs.exists(staging) ? "Staging: " + staging : "",
        original_staging && fs.exists(original_staging)
          ? "Original staging: " + original_staging
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  const cleanup_errors: Error[] = [];
  for (const directory of [staging, rollback]) {
    if (!directory) continue;
    try {
      await fs.remove_async(directory, { recursive: true });
    } catch (error) {
      cleanup_errors.push(
        new Error(directory + ": " + read_error_message(error), { cause: error }),
      );
    }
  }
  if (cleanup_errors.length)
    throw new AppError("file.io_failed", {
      cause: new AggregateError(cleanup_errors),
      message:
        "Game preparation committed. Cleanup failed: " +
        cleanup_errors.map((error) => error.message).join("\n"),
    });
}

/** 准备目录和备份名称保留给提交层，归档不能占用它们。 */
export function validate_game_path(name: string): void {
  if (validate_zip_member_path(name) !== name) throw new Error("Noncanonical game path: " + name);
  const first = name.split("/")[0]!.toLowerCase();
  if (
    /^backup(?:_\d+)?$/u.test(first) ||
    first.startsWith(".linguagacha-") ||
    first === GAME_ORIGINAL_DIRECTORY ||
    first.startsWith(GAME_ORIGINAL_DIRECTORY + "-")
  )
    throw new Error("Member conflicts with preparation files: " + name);
}

/** 跨平台文件树中同一目录也只能有一种大小写拼写。 */
export function assert_game_path_spellings(names: readonly string[]): void {
  const spellings = new Map<string, string>();
  for (const name of names) {
    const parts = name.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join("/"),
        key = prefix.toLowerCase();
      const previous = spellings.get(key);
      if (previous && previous !== prefix)
        throw new Error("Game path differs only by case: " + name);
      spellings.set(key, prefix);
    }
  }
}

/** 包括祖先目录在内拒绝链接和文件占用，检查也能捕获悬空链接。 */
export function assert_regular_path(target: string, fs: NativeFs): void {
  const parent = path.dirname(target);
  if (parent === target) return; // 卷根没有可替换的游戏目录项。
  assert_regular_path(parent, fs);
  try {
    const stat = fs.lstat(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error("Unsafe game filesystem path: " + target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return; // 新成员尚未落盘。
    throw error;
  }
}
/** 收集已有文件时拒绝链接，避免读取越过游戏根目录。 */
export function collect_existing_files(
  root: string,
  name: string,
  files: Set<string>,
  fs: NativeFs,
): void {
  const target = path.join(root, name);
  assert_regular_path(target, fs);
  if (!fs.exists(target)) return;
  if (fs.stat(target).isFile()) {
    files.add(name);
    return;
  }
  for (const entry of fs.read_dirents(target))
    collect_existing_files(root, name + "/" + entry.name, files, fs);
}
