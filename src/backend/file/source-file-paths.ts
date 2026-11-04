import path from "node:path";
import type { NativeFs } from "../../native/native-fs";
import { validate_zip_member_path } from "./shared/zip-members";

const LEGACY_GAME_BACKUP_DIRECTORY = "backup_lg"; // 旧版本生成的备份目录，见 `is_preparation_path`。
export const GAME_WORKSPACE_DIRECTORY = ".tmp";

/** 同根入口互相冲突属于整批输入错误，不能降级为逐文件失败。 */
export class GameSourceConflictError extends Error {}

/**
 * 扫描排除准备工作区和旧版备份，避免将恢复材料导入为原稿。
 * `validate_game_path` 同时拒绝写入这些路径，防止写入结果在下次扫描时被遗漏。
 */
export function is_preparation_path(name: string): boolean {
  const first = name.split("/")[0]!.toLowerCase();
  return (
    first === GAME_WORKSPACE_DIRECTORY ||
    first === LEGACY_GAME_BACKUP_DIRECTORY ||
    /^backup_lg_\d{8}_\d{6}(?:_[1-9]\d*)?$/u.test(first)
  );
}

/** 准备目录和旧版备份名称保留给提交层，归档不能占用它们。 */
export function validate_game_path(name: string): void {
  if (validate_zip_member_path(name) !== name) throw new Error("Noncanonical game path: " + name);
  if (is_preparation_path(name))
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

/** 沿目录逐级排序，保持原稿遍历顺序，避免重新导入时改变条目行号。 */
export function sort_game_paths(names: Iterable<string>): string[] {
  return [...names].sort((left, right) => {
    const a = left.split("/"),
      b = right.split("/");
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const order = a[index]!.localeCompare(b[index]!);
      if (order) return order;
    }
    return a.length - b.length;
  });
}

/**
 * 包括祖先目录在内拒绝链接和文件占用，检查也能捕获悬空链接。
 * `verified` 只属于调用方的一个只读阶段，同阶段内已核对的祖先不再回溯；不得跨阶段或跨操作复用。
 */
export function assert_regular_path(target: string, fs: NativeFs, verified?: Set<string>): void {
  if (verified?.has(target)) return;
  const parent = path.dirname(target);
  if (parent === target) return; // 卷根没有可替换的游戏目录项。
  assert_regular_path(parent, fs, verified);
  try {
    const stat = fs.lstat(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error("Unsafe game filesystem path: " + target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return; // 新成员尚未落盘。
    throw error;
  }
  verified?.add(target);
}
/** 收集已有文件时拒绝链接，避免读取越过游戏根目录。 */
export function collect_existing_files(
  root: string,
  name: string,
  files: Set<string>,
  fs: NativeFs,
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted();
  const target = path.join(root, name);
  assert_regular_path(target, fs);
  if (!fs.exists(target)) return;
  if (fs.stat(target).isFile()) {
    files.add(name);
    return;
  }
  /** 入口类型已确认，递归复核子目录并复用目录项的文件类型。 */
  function visit(relative: string): void {
    signal?.throwIfAborted();
    for (const entry of fs.read_dirents(path.join(root, relative))) {
      signal?.throwIfAborted();
      const child = relative + "/" + entry.name;
      if (entry.isFile()) files.add(child);
      else if (entry.isDirectory()) {
        // 进入子目录前重新检查路径，拒绝枚举后被替换的目录链接。
        assert_regular_path(path.join(root, child), fs);
        visit(child);
      } else throw new Error("Unsafe game filesystem path: " + path.join(root, child));
    }
  }
  visit(name);
}
