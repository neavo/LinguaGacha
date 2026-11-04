import { AppError } from "../error";
import { is_game_file_type, type GameFileType } from "../project-source-formats";
import { is_portable_file_name } from "../utils/file-name";

/** 来源命名与输出校验共用后缀，来源入口格式由 `PROJECT_SOURCE_FORMATS` 维护。 */
export const GAME_ASSET_EXTENSIONS = Object.freeze({
  RENPY: ".renpy",
  GODOT: ".godot",
  RPGMAKER_MV_MZ: ".rpgmaker",
  RPGMAKER_RGSS: ".rpgmaker",
  WOLFRPG: ".wolfrpg",
  TYRANO: ".tyrano",
} satisfies Record<GameFileType, string>);

/** 从规范资产路径取最后一个扩展名。名称首位的点不作为扩展名分隔符。 */
export function project_asset_extension(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

/** 资产身份按原稿投影的目录语义比较，保留名称中的空格。 */
export function normalize_project_asset_path(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (
    /^(?:\/|[a-z]:)/iu.test(normalized) ||
    normalized.includes("\0") ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new AppError("request.validation_failed", {
      message: `Invalid project file path "${value}": use a non-empty relative path without null characters, "." or ".." segments.`,
      diagnostic_context: { reason: "invalid_asset_path", path: value },
    });
  }
  return parts.join("/");
}

/** 文件和父目录分别索引，批量分配与提交校验共用同一冲突规则。 */
export class ProjectAssetPathIndex {
  private readonly files = new Set<string>(); // 文件身份采用正斜线与小写。
  private readonly directories = new Set<string>(); // 文件祖先也占用名称，供双向冲突查询。

  /** 返回需要改名的路径前缀；同名替换仅对已有资产允许。 */
  public find_conflict(value: string, allow_same_path = false): string | null {
    const key = normalize_project_asset_path(value).toLowerCase();
    if ((!allow_same_path && this.files.has(key)) || this.directories.has(key)) return key;
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (this.files.has(parent)) return parent;
    }
    return null;
  }

  /** 正式集合拒绝重名及文件与目录重叠，避免投影时才发现无法写出。 */
  public add(value: string): void {
    const conflict = this.find_conflict(value);
    if (conflict !== null)
      throw new AppError("request.validation_failed", {
        message: `"${value}" conflicts with an existing file or directory at "${conflict}".`,
        diagnostic_context: { reason: "asset_path_conflict", path: value, conflict },
      });
    this.reserve(value);
  }

  /** 原始候选可以互相冲突，先保留其名称以免自动名称抢占其他来源。 */
  public reserve(value: string): void {
    const key = normalize_project_asset_path(value).toLowerCase();
    this.files.add(key);
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index += 1)
      this.directories.add(parts.slice(0, index).join("/"));
  }
}

/** 译文输出位置：游戏移除最后一个合法资产后缀作为独占目录，其余格式保留资产路径。 */
export function source_file_output_path(file: string, file_type?: string): string {
  const normalized = normalize_project_asset_path(file);
  if (!is_game_file_type(file_type)) return normalized;
  const extension = project_asset_extension(normalized);
  if (
    extension !== GAME_ASSET_EXTENSIONS[file_type] &&
    extension !== ".zip" // 历史游戏资产保留 `.zip` 身份与输出目录。
  )
    throw new AppError("request.validation_failed", {
      message: `Invalid game file extension in "${file}": expected "${GAME_ASSET_EXTENSIONS[file_type]}" or ".zip".`,
      diagnostic_context: { reason: "invalid_game_asset_path", path: file },
    });
  const output = normalized.slice(0, -extension.length);
  if (!output.split("/").every(is_portable_file_name))
    throw new AppError("file.invalid_structure", {
      message: `Invalid game output directory name "${output}": names must not contain reserved characters, end with a dot or space, or use a reserved device name.`,
      public_details: { file: output },
    });
  return output;
}

/** 资产身份与译文输出位置分别占位，游戏输出目录由该资产独占。 */
export class SourceFilePathIndex {
  private readonly assets = new ProjectAssetPathIndex(); // 数据库身份也决定工作区原稿入口。
  private readonly outputs = new ProjectAssetPathIndex(); // 游戏输出目录与普通文件按同一规则避让。
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
        message: `"${file}" conflicts with an existing file or directory at "${conflict}".`,
        diagnostic_context: { reason: "asset_path_conflict", path: file, conflict },
      });
    this.reserve(file, file_type);
  }
}

/** 导入、改名提交与译文落盘前核对最终资产集合，防止陈旧预览绕过目录独占规则。 */
export function assert_source_file_paths(
  files: Iterable<{ path: string; file_type: string }>,
): void {
  const index = new SourceFilePathIndex();
  for (const file of files) index.add(file.path, file.file_type);
}
