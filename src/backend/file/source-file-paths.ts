import path from "node:path";
import type { NativeFs } from "../../native/native-fs";
import { is_game_file_type } from "../../shared/project-source-formats";
import { AppError } from "../../shared/error";
import { validate_zip_member_path } from "./shared/zip-members";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../shared/project/project-asset-paths";

export const GAME_BACKUP_DIRECTORY = "backup_lg";
export const GAME_WORKSPACE_DIRECTORY = ".tmp";

/** 译文输出位置：游戏 移除最后一个 `.zip` 作为独占目录，其余格式保留资产路径。 */
export function source_file_output_path(file: string, file_type?: string): string {
  const normalized = normalize_project_asset_path(file);
  if (!is_game_file_type(file_type)) return normalized;
  if (!normalized.endsWith(".zip") || normalized.endsWith("/.zip") || normalized === ".zip")
    throw new AppError("request.validation_failed", {
      diagnostic_context: { reason: "invalid_game_asset_path", path: file },
    });
  return validate_zip_member_path(normalized.slice(0, -4));
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

/** 准备目录和备份名称保留给提交层，归档不能占用它们。 */
export function validate_game_path(name: string): void {
  if (validate_zip_member_path(name) !== name) throw new Error("Noncanonical game path: " + name);
  const first = name.split("/")[0]!.toLowerCase();
  if (
    first === GAME_BACKUP_DIRECTORY ||
    first === GAME_WORKSPACE_DIRECTORY ||
    /^backup(?:_\d+)?$/u.test(first) ||
    first.startsWith(".linguagacha-") ||
    first === ".lg-original" ||
    first.startsWith(".lg-original-")
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
