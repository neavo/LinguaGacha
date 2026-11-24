import type { ProjectFileRecord } from "../project/project-file-records";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { QualityRuleBlock } from "../../shared/quality/quality-rule-state";
import type { ProjectPrompts } from "../../domain/prompt";
import type { ProjectSettings } from "../../domain/project-settings";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";

/**
 * CacheReadPort 限定视图缓存只能读取项目快照，不能写入底层缓存。
 */
export interface CacheReadPort {
  readonly projectPath: string;
  readonly items: {
    readItems(): ProjectItemPublicRecord[];
    readItem(itemId: number): ProjectItemPublicRecord | null;
  };
  readonly files: {
    readFileEntries(): ProjectFileRecord[]; // 按工程文件顺序返回独立列表。
  };
  readonly quality: {
    readBlock(): QualityRuleBlock;
  };
  readonly prompts: {
    readBlock(): ProjectPrompts;
  };
  readonly settings: {
    readBlock(): ProjectSettings;
  };

  /** 返回与当前缓存数据对应的独立修订快照。 */
  readSectionRevisions(): ProjectDataSectionRevisions;
}
