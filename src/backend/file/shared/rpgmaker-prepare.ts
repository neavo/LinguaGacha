import { setImmediate } from "node:timers/promises";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import {
  assert_regular_path,
  validate_game_path,
  assert_game_path_spellings,
} from "../source-file-paths";
import { create_game_workspace } from "./rpgmaker-backup";

/** 暂存完成后的变更清单，由主线程提交到游戏目录。 */
export type GamePreparation = Readonly<{
  writes: readonly string[];
  removes?: readonly string[];
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
  const recovery_files = new Map<string, string>(); // 每个旧文件只保存一份回滚副本。
  const changed: string[] = []; // 包括部分写入失败的目标，按逆序回滚。
  const created_directories: string[] = []; // 仅移除本次创建的空目录。
  // 同步文件操作之间让出事件循环，使取消请求能进入。
  const checkpoint = async () => {
    await setImmediate();
    signal?.throwIfAborted();
  };
  try {
    signal?.throwIfAborted();
    assert_regular_path(root, fs);
    workspace = await create_game_workspace(root, fs);
    staging = path.join(workspace, "stage");
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
    rollback = path.join(workspace, "rollback");
    await fs.make_dir_exclusive(rollback);
    for (const name of rollback_files) {
      await checkpoint();
      const destination = path.join(rollback, name);
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
      fs.rename(path.join(staging, name), destination); // 暂存位于游戏目录所在卷，直接替换避免在目标旁生成临时文件。
    }
    for (const name of plan.removes ?? []) {
      await checkpoint();
      changed.push(name);
      fs.unlink(path.join(root, name));
    }
    signal?.throwIfAborted();
    // 此处完成来源转换；后续清理失败不能撤销已提交的游戏。
  } catch (cause) {
    const recovery_errors: string[] = [];
    for (const name of changed.reverse()) {
      try {
        assert_regular_path(path.join(root, name), fs);
        const saved = recovery_files.get(name);
        if (saved) fs.rename(saved, path.join(root, name));
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
