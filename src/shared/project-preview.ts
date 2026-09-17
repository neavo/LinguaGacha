import type { ProjectTranslationStats } from "./project-translation-stats";

/** 打开前的磁盘预览，文件顺序与工作台保存的工程顺序一致。 */
export type ProjectPreview = {
  file_paths: string[];
  created_at: string;
  updated_at: string;
  translation_stats: ProjectTranslationStats;
};

export type ProjectPreviewResponse = { preview: ProjectPreview };
