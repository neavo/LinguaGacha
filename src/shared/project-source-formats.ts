import type { LocaleKey } from "./i18n";
import type { ItemFileType } from "../domain/item";

/**
 * 新建工程支持的互斥文件格式目录；后端发现、摘要统计和启动页展示共用同一顺序。
 */
export const PROJECT_SOURCE_FORMATS = [
  {
    source_kind: "file",
    id: "txt",
    extension: ".txt",
    title_key: "project_page.formats.txt",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "md",
    extension: ".md",
    title_key: "project_page.formats.md",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "ass",
    extension: ".ass",
    file_type: "ASS",
    title_key: "project_page.formats.ass",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "ssa",
    extension: ".ssa",
    file_type: "ASS",
    title_key: "project_page.formats.ssa",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "lrc",
    extension: ".lrc",
    file_type: "LRC",
    title_key: "project_page.formats.lrc",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "srt",
    extension: ".srt",
    file_type: "SRT",
    title_key: "project_page.formats.srt",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "vtt",
    extension: ".vtt",
    file_type: "VTT",
    title_key: "project_page.formats.vtt",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "pdf",
    extension: ".pdf",
    title_key: "project_page.formats.pdf",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "epub",
    extension: ".epub",
    title_key: "project_page.formats.epub",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "rpy",
    extension: ".rpy",
    title_key: "project_page.formats.rpy",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "json",
    extension: ".json",
    title_key: "project_page.formats.json",
    description_keys: [
      "project_page.formats.mtool",
      "project_page.formats.sextractor",
      "project_page.formats.vntextpatch",
    ],
  },
  {
    source_kind: "file",
    id: "xlsx",
    extension: ".xlsx",
    title_key: "project_page.formats.xlsx",
    description_keys: [
      "project_page.formats.sextractor",
      "project_page.formats.trans_export",
      "project_page.formats.wolf",
    ],
  },
  {
    source_kind: "file",
    id: "trans",
    extension: ".trans",
    title_key: "project_page.formats.trans",
    description_keys: [],
  },
  {
    source_kind: "game",
    id: "rpgmaker_mv_mz",
    extension: ".exe",
    title_key: "project_page.formats.rpgmaker_mv_mz",
    description_keys: [],
  },
  {
    source_kind: "game",
    id: "rpgmaker_rgss",
    extension: ".exe",
    title_key: "project_page.formats.rpgmaker_rgss",
    description_keys: [],
  },
] as const satisfies ReadonlyArray<{
  source_kind: "file" | "game";
  id: string;
  extension: string;
  title_key: LocaleKey;
  description_keys: readonly LocaleKey[];
  file_type?: ItemFileType;
}>;

/** 格式目录同时提供零条目字幕的文件身份。 */
export function read_subtitle_file_type(file_path: string): ItemFileType | null {
  const extension = /\.[^./\\]+$/u.exec(file_path)?.[0].toLowerCase();
  const format = PROJECT_SOURCE_FORMATS.find((entry) => entry.extension === extension);
  return format && "file_type" in format ? format.file_type : null;
}

/** 支持格式目录的稳定跨层身份。 */
export type ProjectSourceFormatId = (typeof PROJECT_SOURCE_FORMATS)[number]["id"];

/** 各互斥格式的文件命中数。 */
export type ProjectSourceFormatHitCounts = Record<ProjectSourceFormatId, number>;

/** 源路径发现完成后返回给 renderer 的公开摘要。 */
export type ProjectSourceFileSummary = {
  source_file_count: number; // 递归发现并按真实路径去重后的支持文件总数
  format_hit_counts: ProjectSourceFormatHitCounts; // 包含目录内全部格式，未命中项固定为零
};

/** 两个原生游戏格式都拥有独立导出目录。 */
export function is_rpgmaker_file_type(
  type: string | undefined,
): type is "RPGMAKER_MV_MZ" | "RPGMAKER_RGSS" {
  return type === "RPGMAKER_MV_MZ" || type === "RPGMAKER_RGSS";
}
