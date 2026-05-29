import type { ProjectDataRecord } from "../project/project-data";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";

export type CacheFreshness = "empty" | "fresh" | "recoverable_error";

export type CacheSnapshot = {
  projectPath: string;
  epoch: number;
  freshness: CacheFreshness;
  sectionRevisions: ProjectDataSectionRevisions;
  itemCount: number;
};

export type CacheItem = ProjectDataRecord;

export type CacheFileEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
};

export interface CacheReadPort {
  readonly items: {
    readItems(query?: { filePath?: string }): CacheItem[];
    readItem(itemId: number): CacheItem | null;
  };
  readonly files: {
    readFileEntries(): CacheFileEntry[];
  };
  readonly quality: {
    readBlock(): ProjectDataRecord;
  };
  readonly prompts: {
    readBlock(): ProjectDataRecord;
  };
  readonly analysis: {
    readBlock(): ProjectDataRecord;
  };
  readSectionRevisions(): ProjectDataSectionRevisions;
  snapshot(): CacheSnapshot;
}
