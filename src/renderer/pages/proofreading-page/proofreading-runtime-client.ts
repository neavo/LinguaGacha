import type {
  ProofreadingFilterPanelState,
  ProofreadingListView,
} from "@/pages/proofreading-page/types";
import type {
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindow,
  ProofreadingListWindowQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRuntimeDeltaInput,
  ProofreadingRuntimeHydrationInput,
  ProofreadingRuntimeSyncState,
} from "@/pages/proofreading-page/proofreading-runtime-engine";
import type { ProofreadingClientItem } from "@/pages/proofreading-page/types";
import { WorkerClientError } from "@/lib/worker-client-error";

type PendingResolver = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type ProofreadingRuntimeWorkerRequest =
  | {
      id: number;
      type: "hydrate_full";
      input: ProofreadingRuntimeHydrationInput;
    }
  | {
      id: number;
      type: "apply_item_delta";
      input: ProofreadingRuntimeDeltaInput;
    }
  | {
      id: number;
      type: "build_list_view";
      input: ProofreadingListViewQuery;
    }
  | {
      id: number;
      type: "read_list_window";
      input: ProofreadingListWindowQuery;
    }
  | {
      id: number;
      type: "read_row_ids_range";
      input: ProofreadingRowIdsRangeQuery;
    }
  | {
      id: number;
      type: "read_items_by_row_ids";
      input: ProofreadingItemsByRowIdsQuery;
    }
  | {
      id: number;
      type: "build_filter_panel";
      input: ProofreadingFilterPanelQuery;
    }
  | {
      id: number;
      type: "dispose_project";
      input: {
        project_id?: string;
      };
    };

type ProofreadingRuntimeWorkerResponse = {
  id: number;
  result: unknown;
};

export function createProofreadingRuntimeClient() {
  let next_request_id = 0;
  let worker: Worker | null = null;
  const pending_requests = new Map<number, PendingResolver>();

  function rejectAll(error: Error): void {
    for (const resolver of pending_requests.values()) {
      resolver.reject(error);
    }
    pending_requests.clear();
  }

  function ensureWorker(): Worker {
    if (worker !== null) {
      return worker;
    }

    if (typeof Worker === "undefined") {
      throw new WorkerClientError("当前环境不支持 proofreading runtime worker。", "unsupported");
    }

    try {
      worker = new Worker(new URL("./proofreading-runtime-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = null;
      throw new WorkerClientError("proofreading runtime worker 初始化失败。", "init_failed");
    }

    worker.addEventListener("message", (event: MessageEvent<ProofreadingRuntimeWorkerResponse>) => {
      const resolver = pending_requests.get(event.data.id);
      if (resolver === undefined) {
        return;
      }
      pending_requests.delete(event.data.id);
      resolver.resolve(event.data.result);
    });
    worker.addEventListener("error", () => {
      rejectAll(
        new WorkerClientError("proofreading runtime worker 执行失败。", "execution_failed"),
      );
      worker?.terminate();
      worker = null;
    });
    return worker;
  }

  async function post_request<TResult>(
    request: Omit<ProofreadingRuntimeWorkerRequest, "id">,
  ): Promise<TResult> {
    const runtime_worker = ensureWorker();

    next_request_id += 1;
    const request_id = next_request_id;
    return await new Promise<TResult>((resolve, reject) => {
      pending_requests.set(request_id, {
        resolve: (result) => {
          resolve(result as TResult);
        },
        reject,
      });
      runtime_worker.postMessage({
        id: request_id,
        ...request,
      });
    });
  }

  return {
    hydrate_full(input: ProofreadingRuntimeHydrationInput): Promise<ProofreadingRuntimeSyncState> {
      return post_request({
        type: "hydrate_full",
        input,
      });
    },
    apply_item_delta(input: ProofreadingRuntimeDeltaInput): Promise<ProofreadingRuntimeSyncState> {
      return post_request({
        type: "apply_item_delta",
        input,
      });
    },
    build_list_view(input: ProofreadingListViewQuery): Promise<ProofreadingListView> {
      return post_request({
        type: "build_list_view",
        input,
      });
    },
    read_list_window(input: ProofreadingListWindowQuery): Promise<ProofreadingListWindow> {
      return post_request({
        type: "read_list_window",
        input,
      });
    },
    read_row_ids_range(input: ProofreadingRowIdsRangeQuery): Promise<string[]> {
      return post_request({
        type: "read_row_ids_range",
        input,
      });
    },
    read_items_by_row_ids(
      input: ProofreadingItemsByRowIdsQuery,
    ): Promise<ProofreadingClientItem[]> {
      return post_request({
        type: "read_items_by_row_ids",
        input,
      });
    },
    build_filter_panel(input: ProofreadingFilterPanelQuery): Promise<ProofreadingFilterPanelState> {
      return post_request({
        type: "build_filter_panel",
        input,
      });
    },
    async dispose_project(project_id?: string): Promise<void> {
      if (worker === null) {
        return;
      }

      await post_request<void>({
        type: "dispose_project",
        input: {
          project_id,
        },
      });
    },
    dispose(): void {
      rejectAll(new WorkerClientError("proofreading runtime worker 已释放。", "disposed"));
      worker?.terminate();
      worker = null;
    },
  };
}
