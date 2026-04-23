import {
  createProofreadingRuntimeEngine,
  type ProofreadingFilterPanelQuery,
  type ProofreadingListViewQuery,
  type ProofreadingRuntimeDeltaInput,
  type ProofreadingRuntimeHydrationInput,
  type ProofreadingRuntimeSyncState,
} from "@/pages/proofreading-page/proofreading-runtime-engine";
import type {
  ProofreadingFilterPanelState,
  ProofreadingListView,
} from "@/pages/proofreading-page/types";

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
  result: ProofreadingRuntimeSyncState | ProofreadingListView | ProofreadingFilterPanelState | null;
};

const runtime_scope = self;
const runtime_engine = createProofreadingRuntimeEngine();

runtime_scope.addEventListener(
  "message",
  (event: MessageEvent<ProofreadingRuntimeWorkerRequest>) => {
    const request = event.data;
    let result: ProofreadingRuntimeWorkerResponse["result"] = null;

    if (request.type === "hydrate_full") {
      result = runtime_engine.hydrate_full(request.input);
    } else if (request.type === "apply_item_delta") {
      result = runtime_engine.apply_item_delta(request.input);
    } else if (request.type === "build_list_view") {
      result = runtime_engine.build_list_view(request.input);
    } else if (request.type === "build_filter_panel") {
      result = runtime_engine.build_filter_panel(request.input);
    } else {
      runtime_engine.dispose_project(request.input.project_id);
    }

    const response: ProofreadingRuntimeWorkerResponse = {
      id: request.id,
      result,
    };
    runtime_scope.postMessage(response);
  },
);

export {};
