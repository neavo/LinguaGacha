/** asset 保存工程顺序；历史条目中独有的文件按首次出现顺序补在末尾。 */
export function build_project_file_paths(
  asset_paths: readonly string[],
  item_paths: readonly string[],
): string[] {
  return [...new Set([...asset_paths, ...item_paths.filter((path) => path !== "")])];
}
