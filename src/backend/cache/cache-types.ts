import type { ProjectDataRecord } from "../project/project-data";
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
 * CacheItem 保持数据库 item 行的普通 JSON 形状。
 */
export type CacheItem = ProjectDataRecord;

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
