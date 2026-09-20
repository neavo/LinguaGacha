import type { PDFDocumentRecord } from "../../shared/pdf";
import type { AppSettingService } from "../app/app-setting-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { CacheReadPort } from "./cache-types";
import * as AppErrors from "../../shared/error";
import { Item, type ProjectItemPublicRecord } from "../../domain/item";
import { is_json_record, read_json_record, type JsonValue } from "../../domain/json";
import { normalize_setting_snapshot } from "../../domain/setting";
import type {
  ProofreadingContextQuery,
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindowQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRowIndexQuery,
  ProofreadingSyncInput,
  ProofreadingSyncState,
  ProofreadingWarningQuery,
  ProofreadingWarningPage,
  createProofreadingReader,
} from "../../shared/proofreading/proofreading-reader";
import type {
  ProofreadingClientItem,
  ProofreadingContextItem,
  ProofreadingFilterPanelState,
  ProofreadingListView,
  ProofreadingItemRecord,
  ProofreadingWarningSummary,
} from "../../shared/proofreading/proofreading-types";
import type { ProofreadingListWindow } from "../../shared/proofreading/proofreading-reader";
import type { QualitySlice, QualitySnapshot } from "../../shared/quality/quality-rule-snapshot";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type { CacheChange } from "./cache-change";
import {
  normalize_text_processing_config,
  type TextProcessingConfig,
} from "../../shared/text/text-types";

type ProofreadingCacheKey = {
  projectPath: string;
  sessionEpoch: number;
  revisions: {
    items: number;
    quality: number;
    proofreading: number;
  };
  processingConfig: TextProcessingConfig;
};

// 热查询只传递轻量身份，完整同步输入在身份未命中后再构造。
type ProofreadingCacheIdentity = {
  key: ProofreadingCacheKey;
  keyString: string;
  sectionRevisions: ProjectDataSectionRevisions;
};

export type ProofreadingCacheResult<TData> = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  data: TData;
};

/**
 * 按工程、会话 epoch、依赖修订和完整文本处理配置缓存校对评估运行态。
 */
export class ProofreadingCache {
  private readonly cache: CacheReadPort; // 完整同步输入只来自当前会话缓存快照
  private readonly app_setting_service: AppSettingService; // 语言缺省值来自当前应用设置
  private readonly worker_client: ComputeWorkerClient; // 质量评估在 worker 中执行
  private readonly reader: ReturnType<typeof createProofreadingReader>; // 持有校对索引与 GUI 列表视图运行态
  private readonly read_pages: (projectPath: string) => PDFDocumentRecord[]; // 只在页面身份未命中时补读数据库事实。
  private session_key: string | null = null; // 工程或缓存世代变化同时撤销三个同步范围。
  private files_revision: number | null = null; // null 表示文件索引需要同步。
  private pages_revision: number | null = null; // 页面正文只随独立修订补读。
  private synced_key: ProofreadingCacheKey | null = null; // 已同步文本评估的身份，文件和页面独立推进。
  private synced_state: ProofreadingSyncState | null = null; // 最近一次成功同步的公开摘要
  private sync_promises = new Map<string, Promise<ProofreadingSyncState>>(); // 合并同身份并发同步

  /**
   * 注入共享缓存、设置、worker 与页面只读入口；本类只维护查询运行态。
   */
  public constructor(options: {
    cache: CacheReadPort;
    appSettingService: AppSettingService;
    workerClient: ComputeWorkerClient;
    reader: ReturnType<typeof createProofreadingReader>;
    readPages: (projectPath: string) => PDFDocumentRecord[];
  }) {
    this.cache = options.cache;
    this.app_setting_service = options.appSettingService;
    this.worker_client = options.workerClient;
    this.reader = options.reader;
    this.read_pages = options.readPages;
  }

  /**
   * 确保指定语言身份完成全量同步并返回当前 revision。
   */
  public async sync(input: {
    sourceLanguage?: JsonValue;
    targetLanguage?: JsonValue;
  }): Promise<ProofreadingCacheResult<ProofreadingSyncState>> {
    const identity = this.build_identity(input);
    const syncState = await this.ensure_synced(identity);
    return this.with_identity(identity, syncState, syncState.revisions);
  }

  /**
   * 基于当前运行态创建筛选、搜索和排序后的列表视图。
   */
  public async list(
    query: ProofreadingListViewQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingListView>> {
    return this.query_current(() => this.reader.read_list_view(query));
  }

  /** 查询当前评估运行态中的真实 warning，不改变 GUI 视图。 */
  public async warnings(
    query: ProofreadingWarningQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingWarningPage>> {
    return this.query_current(() => this.reader.read_warning_page(query));
  }

  /** 读取当前评估运行态中的 warning 类型计数。 */
  public async warningSummary(): Promise<ProofreadingCacheResult<ProofreadingWarningSummary>> {
    return this.query_current(() => this.reader.read_warning_summary());
  }

  /**
   * 读取既有列表视图的一段渲染窗口。
   */
  public async window(
    query: ProofreadingListWindowQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingListWindow>> {
    return this.query_current(() => this.reader.read_list_window(query));
  }

  /**
   * 读取视图窗口对应的稳定 row id。
   */
  public async rowIdsRange(
    query: ProofreadingRowIdsRangeQuery,
  ): Promise<ProofreadingCacheResult<string[]>> {
    return this.query_current(() => this.reader.read_row_ids_range(query));
  }

  /**
   * 将 row id 反查为当前视图索引。
   */
  public async rowIndex(
    query: ProofreadingRowIndexQuery,
  ): Promise<ProofreadingCacheResult<number | null>> {
    return this.query_current(() => this.reader.resolve_row_index(query) ?? null);
  }

  /** 按行身份读取统一运行态，内部路径与列表、筛选保持一致。 */
  public async itemsByRowIds(
    query: ProofreadingItemsByRowIdsQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingClientItem[]>> {
    return this.query_current(() => this.reader.read_items_by_row_ids(query));
  }

  /**
   * 读取目标条目在同文件自然顺序中的上下文，不改变当前列表视图。
   */
  public async context(
    query: ProofreadingContextQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingContextItem[]>> {
    return this.query_current(() => this.reader.read_context_items(query));
  }

  /**
   * 基于当前运行态生成筛选面板计数。
   */
  public async filterPanel(
    query: ProofreadingFilterPanelQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingFilterPanelState>> {
    return this.query_current(() => this.reader.build_filter_panel(query));
  }

  /**
   * 清理指定项目的校对评估运行态；未传项目时清掉当前身份。
   */
  public clearProject(projectPath?: string): void {
    if (
      projectPath !== undefined &&
      this.synced_state !== null &&
      this.synced_state.projectId !== projectPath
    )
      return;
    if (this.synced_state !== null) this.reader.dispose_project(this.synced_state.projectId);
    this.session_key = null;
    this.files_revision = null;
    this.pages_revision = null;
    this.synced_key = null;
    this.synced_state = null;
    this.sync_promises.clear();
  }

  /** 文本依赖变化只撤销评估身份，独立的文件和页面事实可继续复用。 */
  private invalidate_evaluation(): void {
    this.synced_key = null;
    this.sync_promises.clear();
  }

  /**
   * 根据基础缓存变化维护校对运行态，字段 patch 优先走增量应用。
   */
  public async applyChange(
    change: CacheChange,
    nextSectionRevisions: ProjectDataSectionRevisions,
  ): Promise<void> {
    if (change.items.mode !== "delta") {
      if (change.items.mode === "full") this.files_revision = null;
      if (
        change.items.mode === "full" ||
        change.quality.mode === "full" ||
        change.settings.mode === "full"
      ) {
        this.invalidate_evaluation();
      }
      return;
    }

    const item_change = change.items;
    const current_key = this.synced_key;
    if (current_key === null || this.synced_state === null) {
      this.sync_promises.clear();
      return;
    }
    if (current_key.projectPath !== change.projectPath) {
      return;
    }
    const next_revisions = this.to_proofreading_revisions(nextSectionRevisions, current_key);
    if (this.should_clear_delta_identity(current_key, next_revisions)) {
      this.invalidate_evaluation();
      return;
    }

    try {
      const sync_state = this.reader.apply_item_delta({
        projectId: change.projectPath,
        revisions: { ...next_revisions, files: this.synced_state.revisions.files },
        total_item_count: this.cache.snapshot().itemCount,
        upsertItems:
          item_change.sourcePayloadMode === "field-patch"
            ? []
            : this.build_delta_items(item_change.changedIds),
        patchItemIds:
          item_change.fieldPatch === null
            ? []
            : item_change.changedIds.filter((item_id) => !item_change.deleteIds.includes(item_id)),
        fieldPatch: item_change.fieldPatch,
        deleteItemIds: item_change.deleteIds,
      });
      this.synced_state = sync_state;
      this.synced_key = { ...current_key, revisions: next_revisions };
    } catch {
      // 增量应用失败只丢弃派生运行态，下次查询会从权威缓存快照完整重建。
      this.invalidate_evaluation();
    }
  }

  /**
   * 查询前确保当前项目身份已完成同步。
   */
  private async query_current<TData>(read: () => TData): Promise<ProofreadingCacheResult<TData>> {
    const identity = this.build_identity({});
    const sync_state = await this.ensure_synced(identity);
    return this.with_identity(identity, read(), sync_state.revisions);
  }

  /**
   * 同一身份复用进行中的 Promise；未命中时经 worker 和列表读取器完整重建。
   */
  private async ensure_synced(identity: ProofreadingCacheIdentity): Promise<ProofreadingSyncState> {
    const session_key = JSON.stringify([identity.key.projectPath, identity.key.sessionEpoch]);
    if (this.session_key !== session_key) {
      this.clearProject();
      this.session_key = session_key;
    }
    if (this.synced_key !== null && JSON.stringify(this.synced_key) === identity.keyString) {
      if (this.synced_state !== null) {
        return this.sync_content();
      }
    }
    const pending = this.sync_promises.get(identity.keyString);
    if (pending !== undefined) {
      return pending;
    }
    const sync_input = this.build_sync_input(identity);
    const promise = this.worker_client
      .run(
        {
          type: "proofreading_sync",
          input: sync_input,
        },
        new AbortController().signal,
      )
      .then((result) => {
        const current = this.cache.snapshot();
        // 工程切换或失效已撤销这个同步任务，迟到计算不能重新发布旧索引。
        if (
          this.sync_promises.get(identity.keyString) !== promise ||
          current.projectPath !== identity.key.projectPath ||
          current.epoch !== identity.key.sessionEpoch ||
          this.build_identity({
            sourceLanguage: identity.key.processingConfig.source_language,
            targetLanguage: identity.key.processingConfig.target_language,
          }).keyString !== identity.keyString
        ) {
          throw new AppErrors.AppError("request.validation_failed", {
            diagnostic_context: { reason: "stale_proofreading_sync" },
          });
        }
        const sync_state = this.reader.sync_evaluated_full({
          ...sync_input,
          ...result,
        });
        this.synced_key = identity.key;
        this.synced_state = sync_state;
        return this.sync_content();
      });
    this.sync_promises.set(identity.keyString, promise);
    try {
      return await promise;
    } finally {
      if (this.sync_promises.get(identity.keyString) === promise)
        this.sync_promises.delete(identity.keyString);
    }
  }

  /** 文件与页面独立同步，文本评估完成后读取最新排列，避免迟到结果恢复旧顺序。 */
  private sync_content(): ProofreadingSyncState {
    const revisions = this.cache.readSectionRevisions();
    const files_revision = Number(revisions.files ?? 0);
    const pages_revision = Number(revisions.pdf ?? 0);
    if (this.files_revision !== files_revision) {
      this.synced_state = this.reader.sync_files(
        this.cache.files.readFileEntries(),
        files_revision,
      );
      this.files_revision = files_revision;
    }
    if (this.pages_revision !== pages_revision) {
      this.synced_state = this.reader.sync_pages(
        this.read_pages(this.synced_state!.projectId),
        pages_revision,
      );
      this.pages_revision = pages_revision;
    }
    return this.synced_state!;
  }

  /** 用会话身份、依赖修订和文本处理配置构造同步身份。 */
  private build_identity(input: {
    sourceLanguage?: JsonValue;
    targetLanguage?: JsonValue;
  }): ProofreadingCacheIdentity {
    const sectionRevisions = this.cache.readSectionRevisions();
    const snapshot = this.cache.snapshot();
    if (snapshot.projectPath === "") {
      throw new AppErrors.AppError("project.not_loaded");
    }
    const settings = normalize_setting_snapshot(this.app_setting_service.read_setting());
    const processingConfig = normalize_text_processing_config({
      source_language: String(input.sourceLanguage ?? settings.source_language),
      target_language: String(input.targetLanguage ?? settings.target_language),
      clean_ruby: settings.clean_ruby,
    });
    const revisions = {
      items: Number(sectionRevisions.items ?? 0),
      quality: Number(sectionRevisions.quality ?? 0),
      proofreading: Number(sectionRevisions.proofreading ?? 0),
    };
    const key: ProofreadingCacheKey = {
      projectPath: snapshot.projectPath,
      sessionEpoch: snapshot.epoch,
      revisions,
      processingConfig,
    };
    return {
      key,
      keyString: JSON.stringify(key),
      sectionRevisions,
    };
  }

  /** 缓存身份未命中时才复制完整条目与质量配置，热查询不承担 O(N) 输入构造。 */
  private build_sync_input(identity: ProofreadingCacheIdentity): ProofreadingSyncInput {
    const items = this.cache.items.readItems().map((item) => this.to_runtime_item(item));
    return {
      projectId: identity.key.projectPath,
      revisions: { ...identity.key.revisions, files: Number(identity.sectionRevisions.files ?? 0) },
      total_item_count: items.length,
      upsertItems: items,
      quality: this.normalize_quality_state(this.cache.quality.readBlock()),
      processingConfig: identity.key.processingConfig,
    };
  }

  /**
   * 响应绑定实际同步快照的修订号，避免等待期间的新修订给旧结果背书。
   */
  private with_identity<TData>(
    identity: {
      key: ProofreadingCacheKey;
      sectionRevisions: ProjectDataSectionRevisions;
    },
    data: TData,
    revisions: ProofreadingSyncState["revisions"],
  ): ProofreadingCacheResult<TData> {
    if (
      this.session_key !== JSON.stringify([identity.key.projectPath, identity.key.sessionEpoch])
    ) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "stale_proofreading_sync" },
      });
    }
    return {
      projectPath: identity.key.projectPath,
      sectionRevisions: { ...identity.sectionRevisions, ...revisions },
      data,
    };
  }

  /**
   * 只为增量变更读取受影响 item，减少大项目重复复制。
   */
  private build_delta_items(item_ids: number[]): ProofreadingItemRecord[] {
    return item_ids.flatMap((item_id) => {
      const item = this.cache.items.readItem(item_id);
      return item === null ? [] : [this.to_runtime_item(item)];
    });
  }

  /**
   * 将基础 item 缓存收窄为校对列表需要的稳定字段。
   */
  private to_runtime_item(item: ProjectItemPublicRecord): ProofreadingItemRecord {
    const file_path = String(item["file_path"] ?? "");
    return {
      item_id: item.item_id,
      file_path,
      internal_file_path: this.read_internal_file_path(item),
      row_number: item.row_number,
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      name_src: Item.normalize_name_field(item["name_src"]),
      name_dst: Item.normalize_name_field(item["name_dst"]),
      status: String(item["status"] ?? "NONE"),
      text_type: String(item["text_type"] ?? "NONE"),
      retry_count: this.read_number(item["retry_count"], 0),
    };
  }

  /** 格式定位信息只在校对入口解释，普通格式与缺少定位的内容归入无内部路径分组。 */
  private read_internal_file_path(item: ProjectItemPublicRecord): string | null {
    const extra = read_json_record(item["extra_field"]);
    const value =
      item["file_type"] === "TRANS"
        ? read_json_record(extra["trans_ref"])["file_key"]
        : item["file_type"] === "EPUB"
          ? read_json_record(extra["epub"])["doc_path"]
          : null;
    return typeof value === "string" && value !== "" ? value : null;
  }

  /**
   * 将四类质量规则块归一为 worker 可消费快照。
   */
  private normalize_quality_state(block: Record<string, unknown>): QualitySnapshot {
    return {
      glossary: this.normalize_quality_slice(block["glossary"], "custom"),
      pre_replacement: this.normalize_quality_slice(block["pre_replacement"], "custom"),
      post_replacement: this.normalize_quality_slice(block["post_replacement"], "custom"),
      text_preserve: this.normalize_quality_slice(block["text_preserve"], "smart"),
    };
  }

  /**
   * 过滤非法规则条目，并补齐启用状态、模式和 revision。
   */
  private normalize_quality_slice(value: unknown, fallback_mode: string): QualitySlice {
    const record = read_json_record(value);
    const entries = Array.isArray(record["entries"])
      ? record["entries"].flatMap((entry) => {
          return is_json_record(entry) ? [{ ...entry }] : [];
        })
      : [];
    return {
      entries,
      enabled: record["enabled"] !== false,
      mode: String(record["mode"] ?? fallback_mode),
      revision: this.read_number(record["revision"], 0),
    };
  }

  /**
   * 质量或倒退 revision 变化需要丢弃当前增量身份。
   */
  private should_clear_delta_identity(
    current_key: ProofreadingCacheKey,
    next_revisions: ProofreadingCacheKey["revisions"],
  ): boolean {
    return (
      next_revisions.quality !== current_key.revisions.quality ||
      next_revisions.items < current_key.revisions.items ||
      next_revisions.proofreading < current_key.revisions.proofreading
    );
  }

  /**
   * 将全局 section revision 收窄成校对运行态关心的三个分区。
   */
  private to_proofreading_revisions(
    sectionRevisions: ProjectDataSectionRevisions,
    current_key: ProofreadingCacheKey,
  ): ProofreadingCacheKey["revisions"] {
    return {
      items: this.read_number(sectionRevisions.items, current_key.revisions.items),
      quality: this.read_number(sectionRevisions.quality, current_key.revisions.quality),
      proofreading: this.read_number(
        sectionRevisions.proofreading,
        current_key.revisions.proofreading,
      ),
    };
  }

  /**
   * revision、行号和计数统一收窄为非负整数。
   */
  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  }
}
