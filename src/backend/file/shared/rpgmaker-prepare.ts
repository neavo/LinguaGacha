import { setImmediate } from "node:timers/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { validate_zip_member_path } from "./zip-members";

export const GAME_STAGING_PREFIX = ".linguagacha-game-";
export type GamePreparation = Readonly<{
  writes: readonly string[];
  removes?: readonly string[];
  backup?: readonly string[];
}>;

/** 正式目录的唯一写入口，调用方持有写入占用直到 worker、回滚和清理结束。 */
export async function prepare_game_directory(
  root: string,
  fs: NativeFs,
  stage: (directory: string) => Promise<GamePreparation>,
  signal?: AbortSignal,
): Promise<void> {
  let staging: string | null = null;
  let backup: string | null = null;
  const changed: string[] = [];
  const created_directories: string[] = [];
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
    const backup_files = new Set<string>();
    const directory_entries = new Map<string, readonly string[]>();
    for (const name of targets) {
      await checkpoint();
      validate_game_path(name);
      paths.add(name);
      let parent = root;
      for (const part of name.split("/")) {
        if (fs.exists(parent)) {
          let entries = directory_entries.get(parent);
          if (!entries) {
            entries = fs.read_dirents(parent).map((entry) => entry.name);
            directory_entries.set(parent, entries);
          }
          if (entries.some((entry) => entry !== part && entry.toLowerCase() === part.toLowerCase()))
            throw new Error("Game path differs only by case: " + name);
        }
        parent = path.join(parent, part);
      }
      const target = path.join(root, name);
      assert_regular_path(target, fs);
      if (fs.exists(target)) {
        if (!fs.stat(target).isFile())
          throw new Error("Game file conflicts with directory: " + name);
        backup_files.add(name);
      }
    }
    for (const name of plan.backup ?? []) {
      validate_game_path(name);
      collect_existing_files(root, name, backup_files, fs);
    }
    for (const name of plan.writes) {
      assert_regular_path(path.join(staging, name), fs);
      if (!fs.stat(path.join(staging, name)).isFile())
        throw new Error("Missing staged file: " + name);
    }
    if (plan.writes.length || plan.removes?.length) {
      backup = await create_backup_directory(root, fs);
      for (const name of plan.backup ?? []) {
        await checkpoint();
        const target = path.join(root, name);
        if (fs.exists(target) && fs.stat(target).isDirectory())
          fs.copy_entry(target, path.join(backup, name));
      }
      for (const name of backup_files) {
        await checkpoint();
        if (!fs.exists(path.join(backup, name)))
          fs.copy_file(path.join(root, name), path.join(backup, name));
      }
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
      changed.push(name); // 部分写入失败也恢复当前目标。
      fs.copy_file_atomic(path.join(staging, name), destination);
    }
    for (const name of plan.removes ?? []) {
      await checkpoint();
      changed.push(name);
      fs.unlink(path.join(root, name));
    }
    signal?.throwIfAborted();
    await fs.remove_async(staging, { recursive: true });
    staging = null;
    signal?.throwIfAborted();
  } catch (cause) {
    const recovery_errors: string[] = [];
    for (const name of changed.reverse()) {
      try {
        assert_regular_path(path.join(root, name), fs);
        if (fs.exists(path.join(backup!, name)))
          fs.copy_file_atomic(path.join(backup!, name), path.join(root, name));
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
    if (!recovery_errors.length && staging) {
      try {
        await fs.remove_async(staging, { recursive: true });
        staging = null;
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    throw new AppError("file.io_failed", {
      cause,
      message: [
        read_error_message(cause),
        backup ? "Backup: " + backup : "",
        recovery_errors.length
          ? "Recovery or cleanup failed: " + recovery_errors.join("; ")
          : "Original game files retained or restored.",
        staging ? "Staging: " + staging : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

/** 准备目录和备份名称保留给提交层，归档不能占用它们。 */
export function validate_game_path(name: string): void {
  if (validate_zip_member_path(name) !== name) throw new Error("Noncanonical game path: " + name);
  const first = name.split("/")[0]!.toLowerCase();
  if (/^backup(?:_\d+)?$/u.test(first) || first.startsWith(".linguagacha-"))
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
/** 备份前展开目录并拒绝链接，避免递归复制越过游戏根目录。 */
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
/** 独占创建备份目录，已有路径仅影响本次名称。 */
async function create_backup_directory(root: string, fs: NativeFs): Promise<string> {
  for (let index = 1; ; index++) {
    const directory = path.join(root, index === 1 ? "backup" : "backup_" + index);
    try {
      await fs.make_dir_exclusive(directory);
      return directory;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue; // 独占创建解决已有备份的退让。
      throw error;
    }
  }
}
