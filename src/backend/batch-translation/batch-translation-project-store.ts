import type { CacheReadPort } from "../cache/cache-types";
import { ProjectWriteStore, type ProjectWriteSectionAck } from "../project/project-write-store";
import { normalize_translation_item_patches } from "../project/project-write-request";
import {
  read_text_quality_snapshot,
  type TextQualitySnapshot,
  type TextTaskItemRecord,
} from "../../shared/text/text-processing";

/**
 * 项目任务存储端口，是 BatchTranslationRunner 读写项目任务事实的唯一内部入口
 */
export class BatchTranslationProjectStore {
  /** 组合工程身份、事实缓存与统一写入口。 */
  public constructor(
    private readonly project_path: string, // 当前 loaded 工程是唯一读写目标。
    private readonly cache: CacheReadPort, // 热读 items、quality 与 prompts。
    private readonly write_store: ProjectWriteStore, // 统一提交事务与项目变更事件。
  ) {}

  /**
   * 任务启动时读取后端热缓存中的质量规则和提示词快照
   */
  public build_quality_snapshot(): TextQualitySnapshot {
    return read_text_quality_snapshot({
      quality: this.cache.quality.readBlock(),
      prompts: this.cache.prompts.readBlock(),
    });
  }

  /**
   * 提交成功条目，项目写入口决定实际变化及其事件。
   */
  public async commit_translation_batch(
    items: TextTaskItemRecord[],
    affects_proofreading: boolean,
  ): Promise<ProjectWriteSectionAck> {
    const request = {
      projectPath: this.project_path,
      items: normalize_translation_item_patches(items),
    };
    return affects_proofreading
      ? await this.write_store.apply_retranslation_item_patches(request)
      : await this.write_store.apply_translation_item_patches(request);
  }

  /** 读取隔离的完整工程事实；目标准备由规划层负责。 */
  public get_translation_items(): TextTaskItemRecord[] {
    return structuredClone(this.cache.items.readItems());
  }
}
