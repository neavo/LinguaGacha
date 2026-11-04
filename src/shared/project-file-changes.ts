import type { GodotPackOrder, GodotPackPreview } from "./godot";

/** 逐个来源返回只读识别结果，供审批计数和游戏确认使用。 */
export type SourceInspection = {
  source_path: string;
  file_count: number;
  contains_game: boolean;
  godot_packs: GodotPackPreview[];
  failures: { path: string; message: string }[];
};

/** 新增记录只指定来源，目标名称由提交方在写入占用内分配。 */
export type ProjectFileCreate = {
  source_path: string;
  godot_pack_orders?: readonly GodotPackOrder[];
};

/** 按来源汇总已提交资产，只列出自动改名和解析失败的例外。 */
export type AppliedFiles = {
  created: {
    source_path: string;
    files: number;
    items: number;
    pages: number;
    renamed: { from: string; to: string }[];
    parse_failed: string[]; // 原稿已保存，文本解析失败。
  }[];
  replaced: {
    file_path: string;
    source_path: string;
    items: number;
    pages: number;
    inherited: number;
  }[];
  updated: number;
  deleted: number;
};
