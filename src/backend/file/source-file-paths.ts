import path from "node:path";
import type { NativeFs } from "../../native/native-fs";
import { is_game_file_type, type GameFileType } from "../../shared/project-source-formats";
import { AppError } from "../../shared/error";
import { validate_zip_member_path } from "./shared/zip-members";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../shared/project/project-asset-paths";

export const GAME_BACKUP_DIRECTORY = "backup_lg";
export const GAME_WORKSPACE_DIRECTORY = ".tmp";
/** 来源命名与输出校验共用后缀，来源入口格式由 `PROJECT_SOURCE_FORMATS` 维护。 */
export const GAME_ASSET_EXTENSIONS = Object.freeze({
  RENPY: ".renpy",
  GODOT: ".godot",
  RPGMAKER_MV_MZ: ".rpgmaker",
  RPGMAKER_RGSS: ".rpgmaker",
  WOLFRPG: ".wolfrpg",
} satisfies Record<GameFileType, string>);

/** 译文输出位置：游戏移除最后一个合法资产后缀作为独占目录，其余格式保留资产路径。 */
export function source_file_output_path(file: string, file_type?: string): string {
  const normalized = normalize_project_asset_path(file);
  if (!is_game_file_type(file_type)) return normalized;
  const extension = path.posix.extname(normalized);
  if (
    extension !== GAME_ASSET_EXTENSIONS[file_type] &&
    extension !== ".zip" // 历史游戏资产保留 `.zip` 身份与输出目录。
  )
    throw new AppError("request.validation_failed", {
      diagnostic_context: { reason: "invalid_game_asset_path", path: file },
    });
  return validate_zip_member_path(normalized.slice(0, -extension.length));
}

/** 资产身份与译文输出位置分别占位，游戏输出目录由该资产独占。 */
export class SourceFilePathIndex {
  private readonly assets = new ProjectAssetPathIndex(); // 数据库身份也决定工作区原稿入口。
  private readonly outputs = new ProjectAssetPathIndex(); // 游戏 输出目录与普通文件按同一规则避让。
  private readonly output_by_asset = new Map<string, string>(); // 同名替换必须仍占用原来的输出位置。

  /** 替换仅豁免同一资产，防止把另一资产的输出目录当作同名文件。 */
  public find_conflict(file: string, file_type?: string, allow_same_path = false): string | null {
    const output = source_file_output_path(file, file_type);
    const same =
      allow_same_path &&
      this.output_by_asset.get(normalize_project_asset_path(file).toLowerCase()) ===
        output.toLowerCase();
    return this.assets.find_conflict(file, same) ?? this.outputs.find_conflict(output, same);
  }

  /** 原始候选可冲突，预留名称以免被后续自动命名占用。 */
  public reserve(file: string, file_type?: string): void {
    const output = source_file_output_path(file, file_type);
    this.assets.reserve(file);
    this.outputs.reserve(output);
    this.output_by_asset.set(
      normalize_project_asset_path(file).toLowerCase(),
      output.toLowerCase(),
    );
  }

  /** 最终集合须同时满足资产身份和输出目录的独占约束。 */
  public add(file: string, file_type?: string): void {
    const conflict = this.find_conflict(file, file_type);
    if (conflict !== null)
      throw new AppError("request.validation_failed", {
        diagnostic_context: { reason: "asset_path_conflict", path: file, conflict },
      });
    this.reserve(file, file_type);
  }
}

/** 导入提交与译文落盘前核对最终资产集合，防止陈旧预览绕过目录独占规则。 */
export function assert_source_file_paths(
  files: Iterable<{ path: string; file_type: string }>,
): void {
  const index = new SourceFilePathIndex();
  for (const file of files) index.add(file.path, file.file_type);
}

/** 同根入口互相冲突属于整批输入错误，不能降级为逐文件失败。 */
export class GameSourceConflictError extends Error {}

/** 历史目录仅按名称识别，内容不承担原稿身份。 */
export function is_game_backup_history_name(name: string): boolean {
  return /^backup_lg_\d{8}_\d{6}(?:_[1-9]\d*)?$/iu.test(name);
}

/** 准备工作区、备份与历史归档占用的顶层名称，不属于游戏文件。 */
export function is_preparation_path(name: string): boolean {
  const first = name.split("/")[0]!.toLowerCase();
  return (
    first === GAME_BACKUP_DIRECTORY ||
    first === GAME_WORKSPACE_DIRECTORY ||
    is_game_backup_history_name(first)
  );
}

/** 准备目录和备份名称保留给提交层，归档不能占用它们。 */
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
