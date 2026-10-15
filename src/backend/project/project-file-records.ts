/** 资产拥有文件集合、格式身份和顺序。 */
export type ProjectFileRecord = {
  rel_path: string;
  file_type: string;
  sort_index: number;
  game_engine?: string; // TRANS 原稿的引擎上下文，只进入文件运行快照。
};

/** 保留资产路径与顺序，供工程快照及预过滤共用。 */
export function build_project_file_records(
  assets: readonly { path: string; sort_order: number; file_type: string }[],
): Record<string, ProjectFileRecord> {
  return Object.fromEntries(
    [...assets]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((asset) => [
        asset.path,
        {
          rel_path: asset.path,
          file_type: asset.file_type,
          sort_index: asset.sort_order,
        },
      ]),
  );
}
