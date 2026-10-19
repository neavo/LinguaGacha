import path from "node:path";
import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../../native/native-fs";
import { AppError, read_error_message } from "../../../../shared/error";
import {
  assert_regular_path,
  assert_game_path_spellings,
  validate_game_path,
  GAME_BACKUP_DIRECTORY,
} from "../../source-file-paths";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";

/** 调用方持有工程写入占用，逐文件提交允许失败后重试跳过已完成备份。 */
export async function write_game_backup(
  root: string,
  files: ReadonlyMap<string, Uint8Array>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const names = [...files.keys()];
  assert_game_path_spellings(names);
  const paths = new ProjectAssetPathIndex(); // 整批检查文件与父目录占位，避免写入后才发现后续冲突。
  for (const name of names) {
    validate_game_path(name);
    paths.add(name);
  }
  signal?.throwIfAborted();
  const directory = path.join(root, GAME_BACKUP_DIRECTORY);
  try {
    for (const [name, bytes] of files) {
      await setImmediate(); // 让取消请求能在同步原子写入之间进入。
      signal?.throwIfAborted();
      const target = path.join(directory, name);
      assert_regular_path(target, fs); // 同时检查备份根目录和全部祖先，拒绝路径中的链接。
      if (fs.exists(target)) {
        if (!fs.stat(target).isFile()) throw new Error("Game backup path is not a file: " + target);
        continue; // 已有文件保存该路径首次保留的字节，当前游戏变化不能覆盖它。
      }
      fs.write_file_atomic(target, bytes);
    }
    signal?.throwIfAborted();
  } catch (cause) {
    throw new AppError("file.io_failed", {
      cause,
      message: read_error_message(cause) + "\nGame backup: " + directory,
    });
  }
}
