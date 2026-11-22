import type { ProjectDataSectionRevisions } from "../project-event";
import type { ProjectTranslationStats } from "../project-translation-stats";

export type WorkbenchFileEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
  progress: ProjectTranslationStats;
};

export type WorkbenchSnapshot = {
  entries: WorkbenchFileEntry[];
};

export type WorkbenchQueryResponse = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  snapshot: WorkbenchSnapshot;
};
