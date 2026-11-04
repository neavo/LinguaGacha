import type { GodotPackOrder, GodotPackPreview } from "./godot";

/** 按输入顺序返回内置能力识别的来源资产，未匹配格式不计为失败。 */
export type SourceInspection = {
  source_path: string;
  files: { path: string; kind: "file" | "game" }[];
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
    contested: number[][]; // 实际票选且有多种译文结果的已提交条目 ID，按 `src` 与 `name_src` 分组。
  }[];
  updated: number;
  deleted: number;
};
