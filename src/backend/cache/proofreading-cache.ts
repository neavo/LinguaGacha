import { GAME_ENGINES } from "../file/shared/game/engines";
import { is_game_file_type } from "../../shared/project-source-formats";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { CacheReadPort } from "./cache-types";
import * as AppErrors from "../../shared/error";
import type { ProjectItemPublicRecord } from "../../domain/item";
import { read_json_record } from "../../domain/json";
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
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type { ProjectCommittedChange } from "../project/project-committed-change";
export type ProofreadingCacheResult<TData> = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  data: TData;
};

/** 每个打开的工程独立持有校对索引，提交事实决定何时重算。 */
export class ProofreadingCache {
  private readonly cache: CacheReadPort;
  private readonly worker_client: ComputeWorkerClient;
  private readonly reader: ReturnType<typeof createProofreadingReader>;
  private files_revision: number | null = null; // 文件排列可独立于文本评估更新。
  private synced_state: ProofreadingSyncState | null = null;
  private pending: Promise<void> | null = null; // 同时只有一份当前输入可发布评估结果。

  /**
   * 条目和文件顺序由注入的缓存提供。
   */
  public constructor(options: {
    cache: CacheReadPort;
    workerClient: ComputeWorkerClient;
    reader: ReturnType<typeof createProofreadingReader>;
  }) {
    this.cache = options.cache;
    this.worker_client = options.workerClient;
    this.reader = options.reader;
  }

  /** 同步本工程的校对索引并返回实际使用的修订。 */
  public sync(): Promise<ProofreadingCacheResult<ProofreadingSyncState>> {
    return this.query_current((state) => state);
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

  /** 生成前读取当前评估的警告总数，不创建列表视图。 */
  public async warningCount(): Promise<ProofreadingCacheResult<number>> {
    return this.query_current(() => this.reader.read_warning_count());
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

  /** 完整条目直接读取缓存事实，查看数据无需同步质量评估。 */
  public rawItem(item_id: number): ProofreadingCacheResult<ProjectItemPublicRecord> {
    const item = this.cache.items.readItem(item_id);
    if (item === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "proofreading_item_not_found", item_id },
      });
    }
    return {
      projectPath: this.cache.projectPath,
      sectionRevisions: this.cache.readSectionRevisions(),
      data: structuredClone(item), // 格式私有数据不能与缓存共享嵌套引用。
    };
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

  /** 基础缓存重建时一起丢弃校对索引和在途评估。 */
  public clear(): void {
    this.reader.dispose_project(this.cache.projectPath);
    this.files_revision = null;
    this.synced_state = null;
    this.pending = null;
  }

  /** 条目增量更新现有索引，结构、规则或工程设置变化则留待下次查询重建。 */
  public applyChange(
    change: Pick<ProjectCommittedChange, "items" | "updatedSections" | "sectionRevisions">,
  ): void {
    const items = change.items;
    if (items?.mode === "full") this.files_revision = null;
    if (
      items?.mode === "full" ||
      change.updatedSections.includes("quality") ||
      change.updatedSections.includes("project") ||
      (items === undefined && change.updatedSections.includes("proofreading"))
    ) {
      this.synced_state = null;
      this.pending = null;
      return;
    }
    if (items?.mode !== "delta") return;
    this.pending = null;
    const current = this.synced_state;
    if (current === null) return;
    const { items: items_revision, quality, proofreading } = change.sectionRevisions;
    try {
      this.synced_state = this.reader.apply_item_delta({
        projectId: this.cache.projectPath,
        revisions: {
          items: items_revision ?? current.revisions.items,
          quality: quality ?? current.revisions.quality,
          proofreading: proofreading ?? current.revisions.proofreading,
          files: current.revisions.files,
        },
        upsertItems: items.records.map((item) => this.to_runtime_item(item)),
      });
    } catch {
      // 局部索引不可用时，从已提交的基础缓存完整重建。
      this.synced_state = null;
    }
  }

  /** 热查询在同一轮内读取索引与修订，冷查询合并等待后再读取。 */
  private async query_current<TData>(
    read: (state: ProofreadingSyncState) => TData,
  ): Promise<ProofreadingCacheResult<TData>> {
    let revisions = this.cache.readSectionRevisions();
    if (this.synced_state === null) {
      await (this.pending ?? this.start_sync(revisions));
      revisions = this.cache.readSectionRevisions();
    }
    let state = this.synced_state;
    if (state === null) throw this.stale_sync_error();
    const files_revision = revisions.files ?? 0;
    if (this.files_revision !== files_revision) {
      state = this.reader.sync_files(this.cache.files.readFileEntries(), files_revision);
      this.synced_state = state;
      this.files_revision = files_revision;
    }
    return {
      projectPath: this.cache.projectPath,
      sectionRevisions: { ...revisions, ...state.revisions },
      data: read(state),
    };
  }

  /** 只在缺少索引时构造完整 worker 输入。提交可撤销本次发布权。 */
  private start_sync(revisions: ProjectDataSectionRevisions): Promise<void> {
    const input = this.build_sync_input(revisions);
    const pending = this.worker_client
      .run({ type: "proofreading_sync", input }, new AbortController().signal)
      .then((result) => {
        if (this.pending !== pending) throw this.stale_sync_error();
        this.synced_state = this.reader.sync_evaluated_full({ ...input, ...result });
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }

  /** 索引失效后的调用方需要重新查询当前事实。 */
  private stale_sync_error(): AppErrors.AppError {
    return new AppErrors.AppError("request.validation_failed", {
      diagnostic_context: { reason: "stale_proofreading_sync" },
    });
  }

  /** 捕获本次评估的条目、规则、语言和格式上下文。 */
  private build_sync_input(revisions: ProjectDataSectionRevisions): ProofreadingSyncInput {
    const items = this.cache.items.readItems().map((item) => this.to_runtime_item(item));
    const { source_language, target_language } = this.cache.settings.readBlock();
    return {
      projectId: this.cache.projectPath,
      revisions: {
        items: revisions.items ?? 0,
        quality: revisions.quality ?? 0,
        proofreading: revisions.proofreading ?? 0,
        files: revisions.files ?? 0,
      },
      total_item_count: items.length,
      upsertItems: items,
      quality: structuredClone(this.cache.quality.readBlock()),
      processingConfig: {
        source_language,
        target_language,
        file_contexts: Object.fromEntries(
          this.cache.files
            .readFileEntries()
            .map((file) => [
              file.rel_path,
              { file_type: file.file_type, game_engine: file.game_engine },
            ]),
        ),
      },
    };
  }

  /**
   * 将基础 item 缓存收窄为校对列表需要的稳定字段。
   */
  private to_runtime_item(item: ProjectItemPublicRecord): ProofreadingItemRecord {
    return {
      item_id: item.item_id,
      file_path: item.file_path,
      internal_file_path: this.read_internal_file_path(item),
      row_number: item.row_number,
      src: item.src,
      dst: item.dst,
      name_src: item.name_src,
      name_dst: item.name_dst,
      status: item.status,
      file_type: item.file_type,
    };
  }

  /** 格式定位信息只在校对入口解释，普通格式与缺少定位的内容归入无内部路径分组。 */
  private read_internal_file_path(item: ProjectItemPublicRecord): string | null {
    if (is_game_file_type(item.file_type))
      return GAME_ENGINES[item.file_type].read_metadata(item.extra_field).internal_file_path;
    const extra = read_json_record(item["extra_field"]);
    const value =
      item["file_type"] === "TRANS"
        ? read_json_record(extra["trans_ref"])["file_key"]
        : item["file_type"] === "EPUB"
          ? read_json_record(extra["epub"])["doc_path"]
          : null;
    return typeof value === "string" && value !== "" ? value : null;
  }
}
