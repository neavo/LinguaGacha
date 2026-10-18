import type { LocaleKey } from "./i18n";

/** 后端来源发现、摘要统计和工程主页共用的格式目录。 */
export const PROJECT_SOURCE_FORMATS = [
  {
    source_kind: "file",
    id: "txt",
    support_status: "supported",
    extension: ".txt",
    title_key: "project_page.formats.txt",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "md",
    support_status: "supported",
    extension: ".md",
    title_key: "project_page.formats.md",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "ass",
    support_status: "supported",
    extension: ".ass",
    title_key: "project_page.formats.ass",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "ssa",
    support_status: "supported",
    extension: ".ssa",
    title_key: "project_page.formats.ssa",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "lrc",
    support_status: "supported",
    extension: ".lrc",
    title_key: "project_page.formats.lrc",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "srt",
    support_status: "supported",
    extension: ".srt",
    title_key: "project_page.formats.srt",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "vtt",
    support_status: "supported",
    extension: ".vtt",
    title_key: "project_page.formats.vtt",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "pdf",
    support_status: "supported",
    extension: ".pdf",
    title_key: "project_page.formats.pdf",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "epub",
    support_status: "supported",
    extension: ".epub",
    title_key: "project_page.formats.epub",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "rpy",
    support_status: "supported",
    extension: ".rpy",
    title_key: "project_page.formats.rpy",
    description_keys: [],
  },
  {
    source_kind: "file",
    id: "json",
    support_status: "supported",
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
    support_status: "deprecated",
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
    support_status: "deprecated",
    extension: ".trans",
    title_key: "project_page.formats.trans",
    description_keys: [],
  },
  {
    source_kind: "game",
    id: "wolfrpg",
    support_status: "supported",
    extension: ".exe",
    title_key: "project_page.formats.wolfrpg",
    description_keys: [],
  },
  {
    source_kind: "game",
    id: "rpgmaker_mv_mz",
    support_status: "supported",
    extension: ".exe",
    title_key: "project_page.formats.rpgmaker_mv_mz",
    description_keys: [],
  },
  {
    source_kind: "game",
    id: "rpgmaker_rgss",
    support_status: "supported",
    extension: ".exe",
    title_key: "project_page.formats.rpgmaker_rgss",
    description_keys: [],
  },
] as const satisfies ReadonlyArray<{
  source_kind: "file" | "game";
  id: string;
  support_status: "supported" | "deprecated"; // 只表达产品支持策略，来源发现与统计仍使用完整目录
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
  failed_files?: import("./source-file-parse-failure").SourceFileParseFailureRecord[];
  source_file_count: number; // 递归发现并按真实路径去重后的支持文件总数
  format_hit_counts: ProjectSourceFormatHitCounts; // 包含目录内全部格式，未命中项固定为零
};

export type GameFileType = "RPGMAKER_MV_MZ" | "RPGMAKER_RGSS" | "WOLFRPG";

/** 识别需要独立导出目录的原生游戏文件类型。 */
export function is_game_file_type(type: string | undefined): type is GameFileType {
  return type === "RPGMAKER_MV_MZ" || type === "RPGMAKER_RGSS" || type === "WOLFRPG";
}
