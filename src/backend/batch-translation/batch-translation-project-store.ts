import type { BatchTranslationProgress } from "../../domain/batch-translation";

import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import type { CacheReadPort } from "../cache/cache-types";
import { ProjectWriteStore, type ProjectWriteSectionAck } from "../project/project-write-store";
import { ProjectSessionState } from "../project/project-session-state";
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
    private readonly session_state: ProjectSessionState, // 当前 loaded 工程是唯一读写目标。
    private readonly cache: CacheReadPort, // 热读 items、quality 与 prompts。
    private readonly write_store: ProjectWriteStore, // 统一提交事务与项目变更事件。
  ) {}

  /**
   * 任务启动时读取后端热缓存中的质量规则和提示词快照
   */
  public build_quality_snapshot(): TextQualitySnapshot {
    return {
      ...read_text_quality_snapshot({
        quality: this.cache.quality.readBlock(),
        prompts: this.cache.prompts.readBlock(),
      }),
      file_contexts: Object.fromEntries(
        this.cache.files
          .readFileEntries()
          .map((file) => [
            file.rel_path,
            { file_type: file.file_type, game_engine: file.game_engine },
          ]),
      ),
    };
  }

  /**
   * 批次提交包含终态条目或仅用量；项目写入口决定实际变化及其事件。
   */
  public async commit_translation_batch(
    items: TextTaskItemRecord[],
    progress_snapshot: BatchTranslationProgress,
    affects_proofreading: boolean,
  ): Promise<ProjectWriteSectionAck> {
    const request = {
      projectPath: this.session_state.require_loaded_project_path(),
      items: normalize_translation_item_patches(items),
      translationExtras: { ...progress_snapshot }, // 隔离调用方引用，工程字段由唯一写入口收窄。
    };
    return affects_proofreading
      ? await this.write_store.apply_retranslation_item_patches(request)
      : await this.write_store.apply_translation_item_patches(request);
  }

  /**
   * 翻译收尾只持久化进度 extras，避免无变更批次仍触发 item patch
   */
  public async update_translation_progress(progress: BatchTranslationProgress): Promise<void> {
    await this.write_store.update_task_progress_meta({
      projectPath: this.session_state.require_loaded_project_path(),
      meta: { translation_extras: normalize_batch_translation_progress(progress) },
    });
  }

  /** 读取隔离的完整工程事实；目标准备由规划层负责。 */
  public get_translation_items(): TextTaskItemRecord[] {
    this.session_state.require_loaded_project_path();
    return structuredClone(this.cache.items.readItems());
  }
}
