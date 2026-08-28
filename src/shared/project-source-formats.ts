import type { LocaleKey } from "./i18n";

/** 通用文本、字幕与电子书标签共用的逐行 Tooltip 说明。 */
const GENERAL_TEXT_FORMAT_DESCRIPTION_KEYS = [
  "project_page.formats.subtitle",
  "project_page.formats.ebook",
  "project_page.formats.markdown",
] as const satisfies readonly LocaleKey[];

/**
 * 新建工程支持的互斥文件格式目录；后端发现、摘要统计和启动页展示共用同一顺序。
 */
export const PROJECT_SOURCE_FORMATS = [
  {
    id: "txt",
    extension: ".txt",
    title_key: "project_page.formats.txt",
    description_keys: [...GENERAL_TEXT_FORMAT_DESCRIPTION_KEYS, "project_page.formats.sextractor"],
  },
  {
    id: "md",
    extension: ".md",
    title_key: "project_page.formats.md",
    description_keys: GENERAL_TEXT_FORMAT_DESCRIPTION_KEYS,
  },
  {
    id: "pdf",
    extension: ".pdf",
    title_key: "project_page.formats.pdf",
    description_keys: ["project_page.formats.ebook"],
  },
  {
    id: "srt",
    extension: ".srt",
    title_key: "project_page.formats.srt",
    description_keys: GENERAL_TEXT_FORMAT_DESCRIPTION_KEYS,
  },
  {
    id: "ass",
    extension: ".ass",
    title_key: "project_page.formats.ass",
    description_keys: GENERAL_TEXT_FORMAT_DESCRIPTION_KEYS,
  },
  {
    id: "epub",
    extension: ".epub",
    title_key: "project_page.formats.epub",
    description_keys: GENERAL_TEXT_FORMAT_DESCRIPTION_KEYS,
  },
  {
    id: "rpy",
    extension: ".rpy",
    title_key: "project_page.formats.rpy",
    description_keys: ["project_page.formats.renpy"],
  },
  {
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
    id: "trans",
    extension: ".trans",
    title_key: "project_page.formats.trans",
    description_keys: ["project_page.formats.trans_project"],
  },
  {
    id: "xlsx",
    extension: ".xlsx",
    title_key: "project_page.formats.xlsx",
    description_keys: [
      "project_page.formats.sextractor",
      "project_page.formats.trans_export",
      "project_page.formats.wolf",
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  extension: string;
  title_key: LocaleKey;
  description_keys: readonly LocaleKey[];
}>;

/** 支持格式目录的稳定跨层身份。 */
export type ProjectSourceFormatId = (typeof PROJECT_SOURCE_FORMATS)[number]["id"];

/** 各互斥格式的文件命中数。 */
export type ProjectSourceFormatHitCounts = Record<ProjectSourceFormatId, number>;

/** 源路径发现完成后返回给 renderer 的公开摘要。 */
export type ProjectSourceFileSummary = {
  source_file_count: number; // 递归发现并按真实路径去重后的支持文件总数
  format_hit_counts: ProjectSourceFormatHitCounts; // 包含目录内全部格式，未命中项固定为零
};
