import type { AppSettingService } from "./app-setting-service";
import type {
  AppSessionCache,
  AppSessionCachedFileEntry,
  AppSessionCachedItem,
} from "./app-session-cache";
import type { ProofreadingQueryWorker } from "../project/proofreading/proofreading-query-worker";
import * as AppErrors from "../../shared/error";
import { normalize_setting_snapshot } from "../../domain/setting";
import type { ApiJsonValue } from "../api/api-types";
import type {
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindowQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRowIndexQuery,
  ProofreadingRuntimeHydrationInput,
  ProofreadingRuntimeSyncState,
} from "../../shared/proofreading/proofreading-read-model";
import type {
  ProofreadingClientItem,
  ProofreadingFilterPanelState,
  ProofreadingListView,
  ProofreadingRuntimeItemRecord,
} from "../../shared/proofreading/proofreading-types";
import type { ProofreadingListWindow } from "../../shared/proofreading/proofreading-read-model";
import type {
  QualityRuleRuntimeSlice,
  QualityRulesRuntimeState,
} from "../../shared/quality/quality-runtime-state";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";

const APP_SESSION_PROOFREADING_CACHE_VERSION = 1;

export type AppSessionProofreadingCacheKey = {
  projectPath: string;
  sessionEpoch: number;
  revisions: {
    files: number;
    items: number;
    quality: number;
    proofreading: number;
  };
  sourceLanguage: string;
  targetLanguage: string;
  cacheVersion: number;
};

export type AppSessionProofreadingCacheResult<TData> = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  data: TData;
};

export class AppSessionProofreadingCache {
  private readonly app_session_cache: AppSessionCache;
  private readonly app_setting_service: AppSettingService;
  private readonly worker: ProofreadingQueryWorker;
  private synced_key: string | null = null;
  private synced_state: ProofreadingRuntimeSyncState | null = null;
  private sync_promises = new Map<string, Promise<ProofreadingRuntimeSyncState>>();

  public constructor(options: {
    appSessionCache: AppSessionCache;
    appSettingService: AppSettingService;
    worker: ProofreadingQueryWorker;
  }) {
    this.app_session_cache = options.appSessionCache;
    this.app_setting_service = options.appSettingService;
    this.worker = options.worker;
  }

  public async sync(input: {
    sourceLanguage?: ApiJsonValue;
    targetLanguage?: ApiJsonValue;
  }): Promise<AppSessionProofreadingCacheResult<ProofreadingRuntimeSyncState>> {
    const identity = this.build_identity(input);
    const syncState = await this.ensure_synced(identity);
    return this.with_identity(identity, syncState);
  }

  public async list(
    query: ProofreadingListViewQuery,
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingListView>> {
    return this.query_current("list", { action: "list", query });
  }

  public async window(
    query: ProofreadingListWindowQuery,
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingListWindow>> {
    return this.query_current("window", { action: "window", query });
  }

  public async rowIdsRange(
    query: ProofreadingRowIdsRangeQuery,
  ): Promise<AppSessionProofreadingCacheResult<string[]>> {
    return this.query_current("row_ids_range", { action: "row_ids_range", query });
  }

  public async rowIndex(
    query: ProofreadingRowIndexQuery,
  ): Promise<AppSessionProofreadingCacheResult<number | null>> {
    return this.query_current("row_index", { action: "row_index", query });
  }

  public async itemsByRowIds(
    query: ProofreadingItemsByRowIdsQuery,
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingClientItem[]>> {
    return this.query_current("items_by_row_ids", { action: "items_by_row_ids", query });
  }

  public async filterPanel(
    query: ProofreadingFilterPanelQuery,
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingFilterPanelState>> {
    return this.query_current("filter_panel", { action: "filter_panel", query });
  }

  public async disposeProject(projectPath?: string): Promise<void> {
    const current_key = this.synced_key;
    if (current_key === null) {
      this.sync_promises.clear();
      await this.worker.disposeProofreadingCache({ projectPath });
      return;
    }
    const parsed_key = this.parse_key(current_key);
    if (projectPath !== undefined && parsed_key?.projectPath !== projectPath) {
      return;
    }
    this.synced_key = null;
    this.synced_state = null;
    this.sync_promises.clear();
    await this.worker.disposeProofreadingCache({ projectPath, key: current_key });
  }

  private async query_current<TAction extends "list">(
    action: TAction,
    input: { action: TAction; query: ProofreadingListViewQuery },
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingListView>>;
  private async query_current<TAction extends "window">(
    action: TAction,
    input: { action: TAction; query: ProofreadingListWindowQuery },
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingListWindow>>;
  private async query_current<TAction extends "row_ids_range">(
    action: TAction,
    input: { action: TAction; query: ProofreadingRowIdsRangeQuery },
  ): Promise<AppSessionProofreadingCacheResult<string[]>>;
  private async query_current<TAction extends "row_index">(
    action: TAction,
    input: { action: TAction; query: ProofreadingRowIndexQuery },
  ): Promise<AppSessionProofreadingCacheResult<number | null>>;
  private async query_current<TAction extends "items_by_row_ids">(
    action: TAction,
    input: { action: TAction; query: ProofreadingItemsByRowIdsQuery },
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingClientItem[]>>;
  private async query_current<TAction extends "filter_panel">(
    action: TAction,
    input: { action: TAction; query: ProofreadingFilterPanelQuery },
  ): Promise<AppSessionProofreadingCacheResult<ProofreadingFilterPanelState>>;
  private async query_current(
    action: "list" | "window" | "row_ids_range" | "row_index" | "items_by_row_ids" | "filter_panel",
    input:
      | { action: "list"; query: ProofreadingListViewQuery }
      | { action: "window"; query: ProofreadingListWindowQuery }
      | { action: "row_ids_range"; query: ProofreadingRowIdsRangeQuery }
      | { action: "row_index"; query: ProofreadingRowIndexQuery }
      | { action: "items_by_row_ids"; query: ProofreadingItemsByRowIdsQuery }
      | { action: "filter_panel"; query: ProofreadingFilterPanelQuery },
  ): Promise<AppSessionProofreadingCacheResult<unknown>> {
    const identity = this.build_identity({});
    await this.ensure_synced(identity);
    try {
      const result = await this.worker.queryProofreadingCache(
        identity.keyString,
        input,
        new AbortController().signal,
      );
      if (result.action !== action) {
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: { reason: "proofreading_query_worker_action_mismatch" },
        });
      }
      return this.with_identity(identity, result.data);
    } catch (error) {
      this.synced_key = null;
      this.synced_state = null;
      await this.ensure_synced(identity);
      const result = await this.worker.queryProofreadingCache(
        identity.keyString,
        input,
        new AbortController().signal,
      );
      if (result.action !== action) {
        throw error;
      }
      return this.with_identity(identity, result.data);
    }
  }

  private async ensure_synced(identity: {
    keyString: string;
    input: ProofreadingRuntimeHydrationInput;
  }): Promise<ProofreadingRuntimeSyncState> {
    if (this.synced_key === identity.keyString) {
      if (this.synced_state !== null) {
        return this.synced_state;
      }
    }
    const pending = this.sync_promises.get(identity.keyString);
    if (pending !== undefined) {
      return pending;
    }
    const promise = this.worker
      .syncProofreadingCache(identity.keyString, identity.input, new AbortController().signal)
      .then((result) => {
        this.synced_key = identity.keyString;
        this.synced_state = result.syncState;
        return result.syncState;
      });
    this.sync_promises.set(identity.keyString, promise);
    try {
      return await promise;
    } finally {
      this.sync_promises.delete(identity.keyString);
    }
  }

  private build_identity(input: { sourceLanguage?: ApiJsonValue; targetLanguage?: ApiJsonValue }): {
    key: AppSessionProofreadingCacheKey;
    keyString: string;
    sectionRevisions: ProjectDataSectionRevisions;
    input: ProofreadingRuntimeHydrationInput;
  } {
    const sectionRevisions = this.app_session_cache.readSectionRevisions();
    const snapshot = this.app_session_cache.snapshot();
    if (snapshot.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    const settings = normalize_setting_snapshot(this.app_setting_service.read_setting());
    const sourceLanguage = String(input.sourceLanguage ?? settings.source_language);
    const targetLanguage = String(input.targetLanguage ?? settings.target_language);
    const revisions = {
      files: Number(sectionRevisions.files ?? 0),
      items: Number(sectionRevisions.items ?? 0),
      quality: Number(sectionRevisions.quality ?? 0),
      proofreading: Number(sectionRevisions.proofreading ?? 0),
    };
    const key: AppSessionProofreadingCacheKey = {
      projectPath: snapshot.projectPath,
      sessionEpoch: snapshot.epoch,
      revisions,
      sourceLanguage,
      targetLanguage,
      cacheVersion: APP_SESSION_PROOFREADING_CACHE_VERSION,
    };
    const items = this.build_items();
    return {
      key,
      keyString: JSON.stringify(key),
      sectionRevisions,
      input: {
        projectId: snapshot.projectPath,
        revisions,
        total_item_count: items.length,
        upsertItems: items,
        quality: this.normalize_quality_state(this.app_session_cache.readQualityBlock()),
        sourceLanguage,
        targetLanguage,
      },
    };
  }

  private with_identity<TData>(
    identity: {
      key: AppSessionProofreadingCacheKey;
      sectionRevisions: ProjectDataSectionRevisions;
    },
    data: TData,
  ): AppSessionProofreadingCacheResult<TData> {
    return {
      projectPath: identity.key.projectPath,
      sectionRevisions: identity.sectionRevisions,
      data,
    };
  }

  private build_items(): ProofreadingRuntimeItemRecord[] {
    const file_order_by_path = this.build_file_order_by_path(
      this.app_session_cache.readFileEntries(),
    );
    return this.app_session_cache
      .readItems()
      .map((item) => this.to_runtime_item(item, file_order_by_path));
  }

  private build_file_order_by_path(file_entries: AppSessionCachedFileEntry[]): Map<string, number> {
    return new Map(
      file_entries.map((entry, index) => {
        return [entry.rel_path, Number.isFinite(entry.sort_index) ? entry.sort_index : index];
      }),
    );
  }

  private to_runtime_item(
    item: AppSessionCachedItem,
    file_order_by_path: Map<string, number>,
  ): ProofreadingRuntimeItemRecord {
    const file_path = String(item["file_path"] ?? "");
    return {
      item_id: this.read_number(item["item_id"] ?? item["id"], 0),
      file_path,
      file_order: file_order_by_path.get(file_path) ?? Number.MAX_SAFE_INTEGER,
      row_number: this.read_number(item["row_number"] ?? item["row"], 0),
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      status: String(item["status"] ?? "NONE"),
      text_type: String(item["text_type"] ?? "NONE"),
      retry_count: this.read_number(item["retry_count"], 0),
    };
  }

  private normalize_quality_state(block: Record<string, unknown>): QualityRulesRuntimeState {
    return {
      glossary: this.normalize_quality_slice(block["glossary"], "custom"),
      pre_replacement: this.normalize_quality_slice(block["pre_replacement"], "custom"),
      post_replacement: this.normalize_quality_slice(block["post_replacement"], "custom"),
      text_preserve: this.normalize_quality_slice(block["text_preserve"], "smart"),
    };
  }

  private normalize_quality_slice(value: unknown, fallback_mode: string): QualityRuleRuntimeSlice {
    const record =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const entries = Array.isArray(record["entries"])
      ? record["entries"].flatMap((entry) => {
          return typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? [{ ...(entry as Record<string, unknown>) }]
            : [];
        })
      : [];
    return {
      entries,
      enabled: record["enabled"] !== false,
      mode: String(record["mode"] ?? fallback_mode),
      revision: this.read_number(record["revision"], 0),
    };
  }

  private parse_key(value: string): AppSessionProofreadingCacheKey | null {
    try {
      const parsed = JSON.parse(value) as Partial<AppSessionProofreadingCacheKey>;
      return typeof parsed.projectPath === "string"
        ? (parsed as AppSessionProofreadingCacheKey)
        : null;
    } catch {
      return null;
    }
  }

  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  }
}
