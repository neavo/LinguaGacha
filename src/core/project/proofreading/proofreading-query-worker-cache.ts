import { InternalInvariantError } from "../../../shared/error";
import { createProofreadingListService } from "../../../shared/proofreading/proofreading-read-model";
import type { ProofreadingRuntimeSyncState } from "../../../shared/proofreading/proofreading-read-model";
import type {
  ProofreadingQueryWorkerDisposeInput,
  ProofreadingQueryWorkerQueryInput,
  ProofreadingQueryWorkerQueryResult,
  ProofreadingQueryWorkerSyncInput,
  ProofreadingQueryWorkerSyncResult,
} from "./proofreading-query-worker-protocol";

type WorkerProofreadingCacheEntry = {
  key: string;
  projectPath: string;
  service: ReturnType<typeof createProofreadingListService>;
  syncState: ProofreadingRuntimeSyncState;
};

export class ProofreadingQueryWorkerCache {
  private entry: WorkerProofreadingCacheEntry | null = null;

  public sync(
    key: string,
    input: ProofreadingQueryWorkerSyncInput,
  ): ProofreadingQueryWorkerSyncResult {
    if (this.entry?.key === key) {
      return { syncState: this.entry.syncState };
    }
    const service = createProofreadingListService();
    const syncState = service.hydrate_full(input);
    this.entry = {
      key,
      projectPath: input.projectId,
      service,
      syncState,
    };
    return { syncState };
  }

  public query(
    key: string,
    input: ProofreadingQueryWorkerQueryInput,
  ): ProofreadingQueryWorkerQueryResult {
    const entry = this.require_entry(key);
    if (input.action === "list") {
      return { action: input.action, data: entry.service.build_list_view(input.query) };
    }
    if (input.action === "window") {
      return { action: input.action, data: entry.service.read_list_window(input.query) };
    }
    if (input.action === "row_ids_range") {
      return { action: input.action, data: entry.service.read_row_ids_range(input.query) };
    }
    if (input.action === "row_index") {
      return {
        action: input.action,
        data: entry.service.resolve_row_index(input.query) ?? null,
      };
    }
    if (input.action === "items_by_row_ids") {
      return { action: input.action, data: entry.service.read_items_by_row_ids(input.query) };
    }
    if (input.action === "filter_panel") {
      return { action: input.action, data: entry.service.build_filter_panel(input.query) };
    }
    return { action: input.action, data: entry.syncState };
  }

  public dispose(input: ProofreadingQueryWorkerDisposeInput): void {
    if (this.entry === null) {
      return;
    }
    if (input.key !== undefined && this.entry.key !== input.key) {
      return;
    }
    if (input.projectPath !== undefined && this.entry.projectPath !== input.projectPath) {
      return;
    }
    this.entry = null;
  }

  private require_entry(key: string): WorkerProofreadingCacheEntry {
    if (this.entry !== null && this.entry.key === key) {
      return this.entry;
    }
    throw new InternalInvariantError({
      diagnostic_context: { reason: "proofreading_query_worker_key_mismatch" },
    });
  }
}
