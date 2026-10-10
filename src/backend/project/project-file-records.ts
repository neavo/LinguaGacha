import { read_json_integer } from "../../domain/json";
import { build_project_file_paths } from "../../shared/project/project-file-paths";
import { read_subtitle_file_type } from "../../shared/project-source-formats";

/** 文件生成入口提供完整记录，缓存只负责保存和排序。 */
export type ProjectFileRecord = {
  rel_path: string; // 准确文件身份，保留文件名中的空格。
  file_type: string;
  sort_index: number; // 资产顺序优先，历史条目中的独有路径追加在末尾。
};

/** 资产提供工程顺序。历史条目补齐缺失路径，PDF 文档提供自身类型。 */
export function build_project_file_records(
  assets: readonly { path: string; sort_order: number }[],
  items: readonly { file_path: string; file_type: string }[],
  pdf_paths: readonly string[],
): Record<string, ProjectFileRecord> {
  const types = new Map<string, string>();
  for (const item of items) {
    const path = item.file_path;
    if (path !== "" && item.file_type !== "NONE" && !types.has(path))
      types.set(path, item.file_type);
  }
  for (const file_path of pdf_paths) types.set(file_path, "PDF");
  // 文件路径是准确身份，重复记录按原值取首次顺序。
  const asset_orders = new Map<string, number>();
  for (const [index, asset] of assets.entries()) {
    const path = asset.path;
    if (path !== "" && !asset_orders.has(path))
      asset_orders.set(path, Math.max(0, read_json_integer(asset.sort_order, index)));
  }
  const ordered_assets = [...asset_orders].sort((left, right) => left[1] - right[1]);
  const next_order = (ordered_assets.at(-1)?.[1] ?? -1) + 1;
  return Object.fromEntries(
    build_project_file_paths(
      ordered_assets.map(([path]) => path),
      items.map((item) => item.file_path),
    ).map((path, index) => [
      path,
      {
        rel_path: path,
        file_type: types.get(path) ?? read_subtitle_file_type(path) ?? "NONE",
        sort_index: asset_orders.get(path) ?? next_order + index - ordered_assets.length,
      },
    ]),
  );
}
