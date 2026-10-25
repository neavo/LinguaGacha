import type { ProjectTranslationStats } from "./project-translation-stats";

/** 打开前的磁盘预览，文件按稳定的资产 id 顺序展示。 */
export type ProjectPreview = {
  file_paths: string[];
  created_at: string;
  updated_at: string;
  translation_stats: ProjectTranslationStats;
};

export type ProjectPreviewResponse = { preview: ProjectPreview };
