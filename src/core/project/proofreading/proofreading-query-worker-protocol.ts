import type {
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindowQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRowIndexQuery,
  ProofreadingRuntimeHydrationInput,
  ProofreadingRuntimeSyncState,
} from "../../../shared/proofreading/proofreading-read-model";
import type {
  ProofreadingClientItem,
  ProofreadingFilterPanelState,
  ProofreadingListView,
} from "../../../shared/proofreading/proofreading-types";
import type { ProofreadingListWindow } from "../../../shared/proofreading/proofreading-read-model";
import type { LogError } from "../../../shared/error";

export type ProofreadingQueryWorkerSyncInput = ProofreadingRuntimeHydrationInput;

export type ProofreadingQueryWorkerSyncResult = {
  syncState: ProofreadingRuntimeSyncState;
};

export type ProofreadingQueryWorkerDisposeInput = {
  projectPath?: string;
  key?: string;
};

export type ProofreadingQueryWorkerQueryInput =
  | { action: "list"; query: ProofreadingListViewQuery }
  | { action: "window"; query: ProofreadingListWindowQuery }
  | { action: "row_ids_range"; query: ProofreadingRowIdsRangeQuery }
  | { action: "row_index"; query: ProofreadingRowIndexQuery }
  | { action: "items_by_row_ids"; query: ProofreadingItemsByRowIdsQuery }
  | { action: "filter_panel"; query: ProofreadingFilterPanelQuery }
  | { action: "sync_state" };

export type ProofreadingQueryWorkerResultByAction = {
  list: ProofreadingListView;
  window: ProofreadingListWindow;
  row_ids_range: string[];
  row_index: number | null;
  items_by_row_ids: ProofreadingClientItem[];
  filter_panel: ProofreadingFilterPanelState;
  sync_state: ProofreadingRuntimeSyncState;
};

export type ProofreadingQueryWorkerQueryResult =
  | { action: "list"; data: ProofreadingQueryWorkerResultByAction["list"] }
  | { action: "window"; data: ProofreadingQueryWorkerResultByAction["window"] }
  | { action: "row_ids_range"; data: ProofreadingQueryWorkerResultByAction["row_ids_range"] }
  | { action: "row_index"; data: ProofreadingQueryWorkerResultByAction["row_index"] }
  | {
      action: "items_by_row_ids";
      data: ProofreadingQueryWorkerResultByAction["items_by_row_ids"];
    }
  | { action: "filter_panel"; data: ProofreadingQueryWorkerResultByAction["filter_panel"] }
  | { action: "sync_state"; data: ProofreadingQueryWorkerResultByAction["sync_state"] };

export type ProofreadingQueryWorkerIncomingMessage =
  | {
      id: string;
      type: "proofreading.sync";
      key: string;
      input: ProofreadingQueryWorkerSyncInput;
    }
  | {
      id: string;
      type: "proofreading.query";
      key: string;
      input: ProofreadingQueryWorkerQueryInput;
    }
  | {
      id: string;
      type: "proofreading.dispose";
      input: ProofreadingQueryWorkerDisposeInput;
    }
  | {
      id: string;
      type: "cancel";
    };

export type ProofreadingQueryWorkerDataByMessageType = {
  "proofreading.sync": ProofreadingQueryWorkerSyncResult;
  "proofreading.query": ProofreadingQueryWorkerQueryResult;
  "proofreading.dispose": {};
};

export type ProofreadingQueryWorkerOutgoingMessage =
  | {
      id: string;
      ok: true;
      data:
        | ProofreadingQueryWorkerSyncResult
        | ProofreadingQueryWorkerQueryResult
        | Record<string, never>;
    }
  | {
      id: string;
      ok: false;
      error: LogError;
    };
