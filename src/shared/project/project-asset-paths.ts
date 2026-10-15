import { AppError } from "../error";

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
