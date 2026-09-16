/** 文件集合由 asset 拥有；PDF 的格式身份来自独立文档，文本格式沿用解析后的 Item。 */
export function build_project_file_records(
  assets: readonly { path: string; sort_order: number }[],
  items: readonly { file_path: string; file_type: string }[],
  pdf_paths: readonly string[],
): Record<string, { rel_path: string; file_type: string; sort_index: number }> {
  const types = new Map<string, string>();
  for (const item of items)
    if (!types.has(item.file_path)) types.set(item.file_path, item.file_type);
  for (const file_path of pdf_paths) types.set(file_path, "PDF");
  return Object.fromEntries(
    assets.map((asset) => [
      asset.path,
      {
        rel_path: asset.path,
        file_type: types.get(asset.path) ?? "NONE",
        sort_index: asset.sort_order,
      },
    ]),
  );
}
