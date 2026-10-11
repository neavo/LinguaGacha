import { AppError } from "../../shared/error";
import { validate_zip_member_path } from "./zip-members";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../shared/project/project-asset-paths";

/** 译文输出位置：RM 移除最后一个 `.zip` 作为独占目录，其余格式保留资产路径。 */
export function source_file_output_path(file: string, file_type?: string): string {
  const normalized = normalize_project_asset_path(file);
  if (file_type !== "RPGMAKER_MV_MZ") return normalized;
  if (!normalized.endsWith(".zip") || normalized.endsWith("/.zip") || normalized === ".zip")
    throw new AppError("request.validation_failed", {
      diagnostic_context: { reason: "invalid_rpgmaker_asset_path", path: file },
    });
  return validate_zip_member_path(normalized.slice(0, -4));
}

/** 资产身份与译文输出位置分别占位，游戏输出目录由该资产独占。 */
export class SourceFilePathIndex {
  private readonly assets = new ProjectAssetPathIndex(); // 数据库身份也决定工作区原稿入口。
  private readonly outputs = new ProjectAssetPathIndex(); // RM 输出目录与普通文件按同一规则避让。
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
