import type { AppSettingService } from "../app/app-setting-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { CacheFileEntry, CacheReadPort } from "./cache-types";
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
} from "../../shared/proofreading/proofreading-types";
import type { ProofreadingListWindow } from "../../shared/proofreading/proofreading-reader";
import type { QualitySlice, QualitySnapshot } from "../../shared/quality/quality-rule-snapshot";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type { CacheChange } from "./cache-change";
import type { TextProcessingConfig } from "../../shared/text/text-types";

const PROOFREADING_CACHE_VERSION = 2;

export type ProofreadingCacheKey = {
  projectPath: string;
  sessionEpoch: number;
  revisions: {
    files: number;
    items: number;
    quality: number;
    proofreading: number;
  };
  processingConfig: TextProcessingConfig;
  cacheVersion: number;
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
 * 按工程、会话 epoch、依赖 revision 和完整文本处理配置缓存校对评估运行态。
 */
export class ProofreadingCache {
  private readonly cache: CacheReadPort; // 完整同步输入只来自当前会话缓存快照
  private readonly app_setting_service: AppSettingService; // 语言缺省值来自当前应用设置
  private readonly worker_client: ComputeWorkerClient; // 质量评估在 worker 中执行
  private readonly reader: ReturnType<typeof createProofreadingReader>; // 持有校对索引与 GUI 列表视图运行态
  private synced_key: string | null = null; // synced_state 对应的完整身份
  private synced_state: ProofreadingSyncState | null = null; // 最近一次成功同步的公开摘要
  private sync_promises = new Map<string, Promise<ProofreadingSyncState>>(); // 合并同身份并发同步

  /**
   * 注入共享缓存、设置与 worker；本类不读取数据库或写项目事实。
   */
  public constructor(options: {
    cache: CacheReadPort;
    appSettingService: AppSettingService;
    workerClient: ComputeWorkerClient;
    reader: ReturnType<typeof createProofreadingReader>;
  }) {
    this.cache = options.cache;
    this.app_setting_service = options.appSettingService;
    this.worker_client = options.workerClient;
    this.reader = options.reader;
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
    return this.with_identity(identity, syncState);
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

  /**
   * 按 row id 局部读取校对行，并只为返回行从热缓存补 TRANS 内部路径，避免进入全量 worker。
   */
  public async itemsByRowIds(
    query: ProofreadingItemsByRowIdsQuery,
  ): Promise<ProofreadingCacheResult<ProofreadingClientItem[]>> {
    return this.query_current(() => {
      return this.reader.read_items_by_row_ids(query).map((item) => {
        const cached_item = this.cache.items.readItem(Number(item.item_id));
        if (cached_item === null || String(cached_item["file_type"] ?? "") !== "TRANS") {
          return item;
        }
        const extra_field = read_json_record(cached_item["extra_field"]);
        const trans_ref = read_json_record(extra_field["trans_ref"]);
        const internal_file_path = trans_ref["file_key"];
        return typeof internal_file_path === "string" && internal_file_path !== ""
          ? { ...item, internal_file_path }
          : item;
      });
    });
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
  public async clearProject(projectPath?: string): Promise<void> {
    const current_key = this.synced_key;
    if (current_key === null) {
      this.sync_promises.clear();
      return;
    }
    const parsed_key = this.parse_key(current_key);
    if (projectPath !== undefined && parsed_key?.projectPath !== projectPath) {
      return;
    }
    this.synced_key = null;
    this.synced_state = null;
    this.sync_promises.clear();
    if (parsed_key !== null) {
      this.reader.dispose_project(parsed_key.projectPath);
    }
  }

  /**
   * 根据基础缓存变化维护校对运行态，字段 patch 优先走增量应用。
   */
  public async applyChange(
    change: CacheChange,
    nextSectionRevisions: ProjectDataSectionRevisions,
  ): Promise<void> {
    if (change.items.mode !== "delta") {
      if (this.should_clear_for_full_change(change)) {
        await this.clearProject(change.projectPath);
      }
      return;
    }

    const item_change = change.items;
    const current_key = this.synced_key;
    if (current_key === null || this.synced_state === null) {
      this.sync_promises.clear();
      return;
    }
    const parsed_key = this.parse_key(current_key);
    if (parsed_key === null || parsed_key.projectPath !== change.projectPath) {
      return;
    }
    const next_revisions = this.to_proofreading_revisions(nextSectionRevisions, parsed_key);
    if (this.should_clear_delta_identity(parsed_key, next_revisions)) {
      await this.clearProject(change.projectPath);
      return;
    }

    try {
      const sync_state = this.reader.apply_item_delta({
        projectId: change.projectPath,
        revisions: next_revisions,
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
      this.synced_key = JSON.stringify({
        ...parsed_key,
        revisions: next_revisions,
      });
    } catch {
      // 增量应用失败只丢弃派生运行态，下次查询会从权威缓存快照完整重建。
      await this.clearProject(change.projectPath);
    }
  }

  /**
   * 查询前确保当前项目身份已完成同步。
   */
  private async query_current<TData>(read: () => TData): Promise<ProofreadingCacheResult<TData>> {
    const identity = this.build_identity({});
    await this.ensure_synced(identity);
    return this.with_identity(identity, read());
  }

  /**
   * 同一身份复用进行中的 Promise；未命中时经 worker 和列表读取器完整重建。
   */
  private async ensure_synced(identity: ProofreadingCacheIdentity): Promise<ProofreadingSyncState> {
    if (this.synced_key === identity.keyString) {
      if (this.synced_state !== null) {
        return this.synced_state;
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
        const sync_state = this.reader.sync_evaluated_full({
          ...result,
          quality: sync_input.quality,
        });
        this.synced_key = identity.keyString;
        this.synced_state = sync_state;
        return sync_state;
      });
    this.sync_promises.set(identity.keyString, promise);
    try {
      return await promise;
    } finally {
      this.sync_promises.delete(identity.keyString);
    }
  }

  /** 用会话身份、依赖 revision、文本处理配置和版本构造轻量同步 key。 */
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
    const processingConfig: TextProcessingConfig = {
      source_language: String(input.sourceLanguage ?? settings.source_language),
      target_language: String(input.targetLanguage ?? settings.target_language),
      clean_ruby: settings.clean_ruby,
      auto_process_prefix_suffix_preserved_text: settings.auto_process_prefix_suffix_preserved_text,
    };
    const revisions = {
      files: Number(sectionRevisions.files ?? 0),
      items: Number(sectionRevisions.items ?? 0),
      quality: Number(sectionRevisions.quality ?? 0),
      proofreading: Number(sectionRevisions.proofreading ?? 0),
    };
    const key: ProofreadingCacheKey = {
      projectPath: snapshot.projectPath,
      sessionEpoch: snapshot.epoch,
      revisions,
      processingConfig,
      cacheVersion: PROOFREADING_CACHE_VERSION,
    };
    return {
      key,
      keyString: JSON.stringify(key),
      sectionRevisions,
    };
  }

  /** 缓存身份未命中时才复制完整条目与质量配置，热查询不承担 O(N) 输入构造。 */
  private build_sync_input(identity: ProofreadingCacheIdentity): ProofreadingSyncInput {
    const items = this.build_items();
    return {
      projectId: identity.key.projectPath,
      revisions: identity.key.revisions,
      total_item_count: items.length,
      upsertItems: items,
      quality: this.normalize_quality_state(this.cache.quality.readBlock()),
      processingConfig: identity.key.processingConfig,
    };
  }

  /**
   * 将派生数据与计算时的工程身份绑定，供 API 检测陈旧结果。
   */
  private with_identity<TData>(
    identity: {
      key: ProofreadingCacheKey;
      sectionRevisions: ProjectDataSectionRevisions;
    },
    data: TData,
  ): ProofreadingCacheResult<TData> {
    return {
      projectPath: identity.key.projectPath,
      sectionRevisions: identity.sectionRevisions,
      data,
    };
  }

  /**
   * 从基础缓存构造完整校对 item 输入。
   */
  private build_items(): ProofreadingItemRecord[] {
    const file_order_by_path = this.build_file_order_by_path(this.cache.files.readFileEntries());
    return this.cache.items
      .readItems()
      .map((item) => this.to_runtime_item(item, file_order_by_path));
  }

  /**
   * 只为增量变更读取受影响 item，减少大项目重复复制。
   */
  private build_delta_items(item_ids: number[]): ProofreadingItemRecord[] {
    const file_order_by_path = this.build_file_order_by_path(this.cache.files.readFileEntries());
    return item_ids.flatMap((item_id) => {
      const item = this.cache.items.readItem(item_id);
      return item === null ? [] : [this.to_runtime_item(item, file_order_by_path)];
    });
  }

  /**
   * 构造文件路径到稳定排序值的映射，缺少 sort_index 时使用数组顺序兜底。
   */
  private build_file_order_by_path(file_entries: CacheFileEntry[]): Map<string, number> {
    return new Map(
      file_entries.map((entry, index) => {
        return [entry.rel_path, Number.isFinite(entry.sort_index) ? entry.sort_index : index];
      }),
    );
  }

  /**
   * 将基础 item 缓存收窄为校对列表需要的稳定字段。
   */
  private to_runtime_item(
    item: ProjectItemPublicRecord,
    file_order_by_path: Map<string, number>,
  ): ProofreadingItemRecord {
    const file_path = String(item["file_path"] ?? "");
    return {
      item_id: item.item_id,
      file_path,
      file_order: file_order_by_path.get(file_path) ?? Number.MAX_SAFE_INTEGER,
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
   * 解析已同步身份 key，失败时返回 null 触发保守清理。
   */
  private parse_key(value: string): ProofreadingCacheKey | null {
    try {
      const parsed = JSON.parse(value) as Partial<ProofreadingCacheKey>;
      return typeof parsed.projectPath === "string" ? (parsed as ProofreadingCacheKey) : null;
    } catch {
      return null;
    }
  }

  /**
   * 任一基础事实全量重建都会使校对运行态身份失效。
   */
  private should_clear_for_full_change(change: CacheChange): boolean {
    return (
      change.fullRebuild ||
      change.items.mode === "full" ||
      change.files.mode === "full" ||
      change.quality.mode === "full" ||
      change.settings.mode === "full"
    );
  }

  /**
   * 文件、质量或倒退 revision 变化需要丢弃当前增量身份。
   */
  private should_clear_delta_identity(
    current_key: ProofreadingCacheKey,
    next_revisions: ProofreadingCacheKey["revisions"],
  ): boolean {
    return (
      next_revisions.files !== current_key.revisions.files ||
      next_revisions.quality !== current_key.revisions.quality ||
      next_revisions.items < current_key.revisions.items ||
      next_revisions.proofreading < current_key.revisions.proofreading ||
      current_key.cacheVersion !== PROOFREADING_CACHE_VERSION
    );
  }

  /**
   * 将全局 section revision 收窄成校对运行态关心的四个分区。
   */
  private to_proofreading_revisions(
    sectionRevisions: ProjectDataSectionRevisions,
    current_key: ProofreadingCacheKey,
  ): ProofreadingCacheKey["revisions"] {
    return {
      files: this.read_number(sectionRevisions.files, current_key.revisions.files),
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
