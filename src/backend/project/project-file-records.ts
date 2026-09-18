import { build_project_file_paths } from "../../shared/project/project-file-paths";

/** asset 提供工程顺序，历史条目独有路径补在末尾；PDF 格式由独立文档决定。 */
export function build_project_file_records(
  assets: readonly { path: string; sort_order: number }[],
  items: readonly { file_path: string; file_type: string }[],
  pdf_paths: readonly string[],
): Record<string, { rel_path: string; file_type: string; sort_index: number }> {
  const types = new Map<string, string>();
  for (const item of items)
    if (!types.has(item.file_path)) types.set(item.file_path, item.file_type);
  for (const file_path of pdf_paths) types.set(file_path, "PDF");
  const ordered_assets = [...assets].sort((left, right) => left.sort_order - right.sort_order);
  const orders = new Map(ordered_assets.map((asset) => [asset.path, asset.sort_order]));
  const next_order = (ordered_assets.at(-1)?.sort_order ?? -1) + 1;
  return Object.fromEntries(
    build_project_file_paths(
      ordered_assets.map((asset) => asset.path),
      items.map((item) => item.file_path),
    ).map((path, index) => [
      path,
      {
        rel_path: path,
        file_type: types.get(path) ?? "NONE",
        sort_index: orders.get(path) ?? next_order + index - ordered_assets.length,
      },
    ]),
  );
}
