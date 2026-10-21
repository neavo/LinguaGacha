import { setImmediate } from "node:timers/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { NativeFs } from "../../../../native/native-fs";
import { AppError, read_error_message } from "../../../../shared/error";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";
import {
  assert_regular_path,
  validate_game_path,
  assert_game_path_spellings,
  GAME_WORKSPACE_DIRECTORY,
  GAME_BACKUP_DIRECTORY,
} from "../../source-file-paths";

/** 暂存完成后的变更清单，由主线程提交到游戏目录。 */
export type GamePreparation = Readonly<{
  writes: readonly string[];
  directories?: readonly string[];
  removes?: readonly string[];
  backups?: readonly string[]; // 原载体同卷移动到长期备份，避免复制大包。
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
  let workspace: string | null = null;
  const recovery_files = new Map<string, string | null>(); // 按首次修改顺序登记，null 表示本轮新增目标。
  const created_directories: string[] = []; // 仅移除本次创建的空目录。
  // 同步文件操作之间让出事件循环，使取消请求能进入。
  const checkpoint = async () => {
    await setImmediate();
    signal?.throwIfAborted();
  };
  try {
    signal?.throwIfAborted();
    assert_regular_path(root, fs);
    const candidate = path.join(root, GAME_WORKSPACE_DIRECTORY);
    await fs.make_dir_exclusive(candidate);
    workspace = candidate; // 创建成功后才取得清理所有权，不能接管已有恢复材料。
    staging = path.join(workspace, "stage");
    await fs.make_dir_exclusive(staging);
    const plan = await stage(staging);
    signal?.throwIfAborted();
    const targets = [
      ...new Set([...plan.writes, ...(plan.removes ?? []), ...(plan.backups ?? [])]),
    ];
    const directories = new Set(plan.directories ?? []);
    for (const name of [...targets, ...directories]) validate_game_path(name);
    const declared = new ProjectAssetPathIndex();
    for (const name of [...plan.writes, ...(plan.removes ?? [])]) declared.add(name);
    const backups = new Map<string, string>();
    for (const name of plan.backups ?? []) {
      if (backups.has(name) || plan.removes?.includes(name))
        throw new Error("Duplicate game backup: " + name);
      const original = path.join(root, name),
        destination = path.join(root, GAME_BACKUP_DIRECTORY, name);
      assert_regular_path(original, fs);
      assert_regular_path(destination, fs);
      if (!fs.stat(original).isFile()) throw new Error("Missing game carrier: " + name);
      if (
        fs.exists(destination) &&
        (!fs.stat(destination).isFile() || !(await same_file(original, destination, fs, signal)))
      )
        throw new Error(
          "Conflicting game carrier backup; move backup_lg before importing: " + name,
        );
      backups.set(name, destination);
    }
    // 备份路径由事务生成，管理目录不允许来自引擎成员清单。
    const backup_names = [...backups.keys()].map((name) => GAME_BACKUP_DIRECTORY + "/" + name);
    // 显式目录和文件父目录共同声明正式目录需求，不能按文件占位加入资产索引。
    for (const name of [...directories, ...plan.writes, ...backup_names]) {
      const parts = name.split("/");
      for (let length = 1; length < parts.length; length++)
        directories.add(parts.slice(0, length).join("/"));
    }
    assert_game_path_spellings([...targets, ...backup_names, ...directories]);
    const paths = new ProjectAssetPathIndex();
    const file_paths = new Set([...targets, ...backup_names].map((name) => name.toLowerCase()));
    for (const name of [...targets, ...backup_names]) paths.add(name);
    for (const name of directories)
      if (file_paths.has(name.toLowerCase()))
        throw new Error("Game file conflicts with required directory: " + name);
    const ordered_directories = [...directories].sort(
      (left, right) => left.split("/").length - right.split("/").length || (left < right ? -1 : 1),
    );
    const existing_targets = new Set<string>();
    const directory_entries = new Map<string, Map<string, string | null>>();
    for (const name of [...ordered_directories, ...targets, ...backup_names]) {
      await checkpoint();
      const target = path.join(root, name);
      assert_regular_path(target, fs);
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
      if (fs.exists(target)) {
        if (directories.has(name)) {
          if (!fs.stat(target).isDirectory())
            throw new Error("Game directory conflicts with file: " + name);
        } else {
          if (!fs.stat(target).isFile())
            throw new Error("Game file conflicts with directory: " + name);
          if (!backup_names.includes(name)) existing_targets.add(name);
        }
      }
    }
    for (const name of plan.writes) {
      await checkpoint();
      assert_regular_path(path.join(staging, name), fs);
      if (!fs.stat(path.join(staging, name)).isFile())
        throw new Error("Missing staged file: " + name);
    }
    rollback = path.join(workspace, "rollback");
    await fs.make_dir_exclusive(rollback);
    /** 首次修改保存旧目标，后续写入继续使用同一恢复来源。 */
    const save_target = (name: string) => {
      if (recovery_files.has(name)) return;
      const target = path.join(root, name);
      if (existing_targets.has(name)) {
        const saved = path.join(rollback!, name);
        fs.rename(target, saved);
        recovery_files.set(name, saved); // 移动后立即登记，取消不能落在两步之间。
      } else recovery_files.set(name, null);
    };
    for (const name of ordered_directories) {
      await checkpoint();
      const directory = path.join(root, name);
      assert_regular_path(directory, fs);
      if (fs.exists(directory)) {
        if (!fs.stat(directory).isDirectory())
          throw new Error("Game directory conflicts with file: " + name);
      } else {
        await fs.make_dir_exclusive(directory);
        created_directories.push(directory);
      }
    }
    for (const [name, destination] of backups) {
      await checkpoint();
      assert_regular_path(destination, fs);
      if (fs.exists(destination)) {
        save_target(name);
      } else {
        fs.rename(path.join(root, name), destination);
        recovery_files.set(name, destination);
      }
    }
    for (const name of plan.writes) {
      await checkpoint();
      const destination = path.join(root, name);
      assert_regular_path(destination, fs);
      save_target(name);
      fs.rename(path.join(staging, name), destination); // 暂存位于游戏目录所在卷，直接替换避免在目标旁生成临时文件。
    }
    for (const name of plan.removes ?? []) {
      await checkpoint();
      const target = path.join(root, name);
      assert_regular_path(target, fs);
      fs.stat(target); // 缺失的删除目标仍须报告错误。
      save_target(name);
      if (fs.exists(target)) fs.unlink(target);
    }
    signal?.throwIfAborted();
    // 此处完成来源转换；后续清理失败不能撤销已提交的游戏。
  } catch (cause) {
    const recovery_errors: string[] = [];
    for (const [name, saved] of [...recovery_files].reverse()) {
      try {
        assert_regular_path(path.join(root, name), fs);
        if (saved !== null) fs.rename(saved, path.join(root, name));
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
    if (!recovery_errors.length && workspace) {
      try {
        await fs.remove_async(workspace, { recursive: true });
      } catch (error) {
        recovery_errors.push(workspace + ": " + read_error_message(error));
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
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  try {
    await fs.remove_async(workspace, { recursive: true });
  } catch (cause) {
    throw new AppError("file.io_failed", {
      cause,
      message:
        "Game preparation committed. Cleanup failed: " +
        workspace +
        "\n" +
        read_error_message(cause),
    });
  }
}

/** 大载体只流式核对指纹，重复导入不能覆盖不同版本的恢复依据。 */
async function same_file(
  left: string,
  right: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<boolean> {
  if (fs.stat(left).size !== fs.stat(right).size) return false;
  /** 流式计算载体摘要，块间继续响应取消。 */
  const digest = async (file: string): Promise<string> => {
    const hash = createHash("sha256");
    for await (const bytes of fs.create_read_stream(file)) {
      signal?.throwIfAborted();
      hash.update(bytes);
    }
    signal?.throwIfAborted();
    return hash.digest("hex");
  };
  return (await digest(left)) === (await digest(right));
}
