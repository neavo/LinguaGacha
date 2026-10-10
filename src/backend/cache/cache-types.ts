import type { ProjectFileRecord } from "../project/project-file-records";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { QualityRuleBlock } from "../../shared/quality/quality-rule-state";
import type { ProjectPrompts } from "../../domain/prompt";
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
 * CacheReadPort 限定视图缓存只能读取项目快照，不能写入底层缓存。
 */
export interface CacheReadPort {
  readonly items: {
    readItems(): ProjectItemPublicRecord[];
    readItem(itemId: number): ProjectItemPublicRecord | null;
  };
  readonly files: {
    readFileEntries(): ProjectFileRecord[];
  };
  readonly quality: {
    readBlock(): QualityRuleBlock;
  };
  readonly prompts: {
    readBlock(): ProjectPrompts;
  };

  readSectionRevisions(): ProjectDataSectionRevisions;
  snapshot(): CacheSnapshot;
}
