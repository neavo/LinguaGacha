import type { ProjectItemPublicRecord } from "../../domain/item";
import type { TextTaskItemRecord } from "../../shared/text/text-types";
import type {
  BatchTranslationProgress,
  BatchTranslationStartMode,
} from "../../domain/batch-translation";

import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import type { CacheReadPort } from "../cache/cache-types";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectWriteStore, type ProjectWriteSectionAck } from "../project/project-write-store";
import { ProjectSessionState } from "../project/project-session-state";
import { normalize_translation_item_patches } from "../project/project-write-request";
import { TextQualitySnapshotTool, type TextQualitySnapshot } from "../../shared/text/text-types";
import { read_json_record } from "../../domain/json";

/**
 * 项目任务存储端口，是 BatchTranslationRunner 读写项目任务事实的唯一内部入口
 */
export class BatchTranslationProjectStore {
  private readonly database: ProjectDatabase; // 任务写库也必须经由 ProjectDatabase workflow

  private readonly session_state: ProjectSessionState; // 当前 loaded 工程是任务读写唯一目标

  private readonly cache: CacheReadPort; // 任务启动热读 items / quality / prompts，写库仍只走 ProjectDatabase

  private readonly write_store: ProjectWriteStore; // 事务与项目变更事件由 ProjectWriteStore 统一完成

  /**
   * BatchTranslationProjectStore 只组合现有 TS 权威，不自行持有长期项目缓存
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    cache: CacheReadPort,
    write_store: ProjectWriteStore,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.cache = cache;
    this.write_store = write_store;
  }

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
   * 翻译批次只接收已收窄的 item 与进度；scope 决定是否同步推进校对事实
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

  /** 复制当前条目；reset 为本轮输入清空译文与重试状态。 */
  public get_translation_items(mode: BatchTranslationStartMode): {
    items: TextTaskItemRecord[];
    progress: BatchTranslationProgress;
  } {
    this.session_state.require_loaded_project_path();
    const items = structuredClone(this.cache.items.readItems());
    if (mode === "reset")
      for (const item of items) {
        item.dst = "";
        item.status = "NONE";
        item.retry_count = 0;
      }
    return { items, progress: this.read_progress() };
  }
  /** 按指定顺序准备重翻副本，保留缓存中的原始事实。 */
  public get_translation_items_by_scope(item_ids: readonly number[]): {
    items: TextTaskItemRecord[];
    progress: BatchTranslationProgress;
  } {
    this.session_state.require_loaded_project_path();
    const items = item_ids
      .map((id) => this.cache.items.readItem(id))
      .filter((item): item is ProjectItemPublicRecord => item !== null)
      .map((item) => ({ ...structuredClone(item), status: "NONE", retry_count: 0 }));
    return { items, progress: this.read_progress() };
  }
  /** 读取当前工程持久化的累计翻译进度。 */
  private read_progress(): BatchTranslationProgress {
    const meta = read_json_record(
      this.database.get_all_meta(this.session_state.require_loaded_project_path()),
    );
    return normalize_batch_translation_progress(meta["translation_extras"]);
  }
}
