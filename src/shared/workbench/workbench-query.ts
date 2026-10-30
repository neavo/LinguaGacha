import type { ProjectDataSectionRevisions } from "../project-event";

/** 后端统一提供文件进度；PDF 按原页统计。 */
export type WorkbenchFileProgress = {
  unit: "line" | "page"; // 文本按条目、PDF 按原页计数
  total_count: number;
  completed_count: number;
  skipped_count: number;
  pending_count: number;
  completion_percent: number; // 成功与跳过合计后按工程口径取整
};

export type WorkbenchFileEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
  progress: WorkbenchFileProgress;
};

export type WorkbenchSnapshot = {
  entries: WorkbenchFileEntry[];
};

export type WorkbenchQueryResponse = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  snapshot: WorkbenchSnapshot;
};
