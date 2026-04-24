import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from "@/app/runtime/project-pages/project-pages-barrier";

export type ProjectPagesRuntimeAdapterOptions = {
  createProjectPagesBarrierCheckpoint: () => ProjectPagesBarrierCheckpoint;
  waitForProjectPagesBarrier: (
    kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
    options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
  ) => Promise<void>;
};

export type WorkbenchPageRuntimeAdapter = {
  file_op_running: boolean;
  cache_stale: boolean;
  is_refreshing: boolean;
  last_loaded_at: number | null;
  settled_project_path: string;
};

export type ProofreadingPageRuntimeAdapter = {
  cache_stale: boolean;
  is_refreshing: boolean;
  last_loaded_at: number | null;
  settled_project_path: string;
};

export type ProjectPagesRuntimeAdapters = {
  proofreading_page_state: ProofreadingPageRuntimeAdapter;
  workbench_live_state: WorkbenchPageRuntimeAdapter;
};
