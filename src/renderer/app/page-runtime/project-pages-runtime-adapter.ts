import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from "@/app/page-runtime/project-pages-barrier";
import type {
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "@/project/store/project-store";

export type ProjectPagesRuntimeAdapterOptions = {
  createProjectPagesBarrierCheckpoint: () => ProjectPagesBarrierCheckpoint;
  waitForProjectPagesBarrier: (
    kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
    options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
  ) => Promise<void>;
};

export type WorkbenchPageRuntimeAdapter = {
  file_op_running: boolean;
  is_refreshing: boolean;
  consumed_revisions: ProjectDataSectionRevisions;
  required_sections: ProjectDataSection[];
  settled_project_path: string;
};

export type ProofreadingPageRuntimeAdapter = {
  is_refreshing: boolean;
  consumed_revisions: ProjectDataSectionRevisions;
  required_sections: ProjectDataSection[];
  settled_project_path: string;
};

export type ProjectPagesRuntimeAdapters = {
  proofreading_page_state: ProofreadingPageRuntimeAdapter;
  workbench_live_state: WorkbenchPageRuntimeAdapter;
};
