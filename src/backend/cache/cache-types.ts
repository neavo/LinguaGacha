import type { ProjectItemPublicRecord } from "../../domain/item";
import type { JsonRecord } from "../../domain/json";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";

/**
 * CacheFreshness 表示 session 热读缓存是否可直接服务查询。
 */
export type CacheFreshness = "empty" | "fresh" | "recoverable_error";

/**
 * CacheSnapshot 是跨缓存模块共享的最小项目身份与 revision 快照。
 */
export type CacheSnapshot = {
  projectPath: string;
  epoch: number;
  freshness: CacheFreshness;
  sectionRevisions: ProjectDataSectionRevisions;
  itemCount: number;
};

/**
 * CacheFileEntry 是前端和校对列表需要的轻量文件事实。
 */
export type CacheFileEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
};

/**
 * CacheReadPort 限定视图缓存只能读取项目快照，不能写入底层缓存。
 */
export interface CacheReadPort {
  readonly items: {
    readItems(): ProjectItemPublicRecord[];
    readItem(itemId: number): ProjectItemPublicRecord | null;
  };
  readonly files: {
    readFileEntries(): CacheFileEntry[];
  };
  readonly quality: {
    readBlock(): JsonRecord;
  };
  readonly prompts: {
    readBlock(): JsonRecord;
  };

  readSectionRevisions(): ProjectDataSectionRevisions;
  snapshot(): CacheSnapshot;
}
