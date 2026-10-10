/** 空值校验不改写文件身份，按原值去重并保留首次顺序。 */
export function normalize_source_paths(source_paths: string[]): string[] {
  return [...new Set(source_paths.filter((source_path) => source_path.trim() !== ""))];
}
