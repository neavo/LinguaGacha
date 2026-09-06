import type { TextTaskItemRecord } from "../../shared/text/text-types";
import type { BatchTranslationProgress } from "../../domain/batch-translation";

import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import type { CacheReadPort } from "../cache/cache-types";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectWriteStore, type ProjectWriteSectionAck } from "../project/project-write-store";
import { ProjectSessionState } from "../project/project-session-state";
import { normalize_translation_item_patches } from "../project/project-write-request";
import { TextQualitySnapshotTool, type TextQualitySnapshot } from "../../shared/text/text-types";

/**
 * 项目任务存储端口，是 BatchTranslationRunner 读写项目任务事实的唯一内部入口
 */
export class BatchTranslationProjectStore {
  /** 组合工程连接、事实缓存与统一写入口。 */
  public constructor(
    private readonly database: ProjectDatabase, // 数据库连接租约由任务持有。
    private readonly session_state: ProjectSessionState, // 当前 loaded 工程是唯一读写目标。
    private readonly cache: CacheReadPort, // 热读 items、quality 与 prompts。
    private readonly write_store: ProjectWriteStore, // 统一提交事务与项目变更事件。
  ) {}

  /**
   * 后台任务长流程显式保留当前工程连接，结束后释放让 .lg 回到单文件稳定态
   */
  public acquire_project_lease(owner: string): () => void {
    return this.database.acquire_project_lease(
      this.session_state.require_loaded_project_path(),
      owner,
    );
  }

  /**
   * 任务启动时读取后端热缓存中的质量规则和提示词快照
   */
  public build_quality_snapshot(): TextQualitySnapshot {
    return TextQualitySnapshotTool.from_api_value({
      quality: this.cache.quality.readBlock(),
      prompts: this.cache.prompts.readBlock(),
    });
  }

  /**
   * 翻译批次只接收已收窄的 item 与进度；执行目的决定是否同步推进校对事实
   */
  public async commit_translation_items(
    items: TextTaskItemRecord[],
    progress_snapshot: BatchTranslationProgress,
    affects_proofreading: boolean,
  ): Promise<ProjectWriteSectionAck> {
    const request = {
      projectPath: this.session_state.require_loaded_project_path(),
      items: normalize_translation_item_patches(items),
      translationExtras: normalize_batch_translation_progress(progress_snapshot),
    };
    return affects_proofreading
      ? await this.write_store.apply_retranslation_item_patches(request)
      : await this.write_store.apply_translation_item_patches(request);
  }

  /**
   * 翻译收尾只持久化进度 extras，避免无变更批次仍触发 item patch
   */
  public update_translation_progress(progress: BatchTranslationProgress): void {
    this.write_store.update_task_progress_meta({
      projectPath: this.session_state.require_loaded_project_path(),
      meta: { translation_extras: { ...progress } },
    });
  }

  /** 读取隔离的完整工程事实；目标准备由规划层负责。 */
  public get_translation_items(): TextTaskItemRecord[] {
    this.session_state.require_loaded_project_path();
    return structuredClone(this.cache.items.readItems());
  }
}
