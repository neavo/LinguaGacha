import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createProjectPagesBarrierCheckpoint,
  isProjectPagesBarrierReady,
  type ProjectPagesBarrierCheckpoint,
  type ProjectPagesBarrierKind,
  type ProjectPagesBarrierOptions,
  type ProjectPagesBarrierState,
} from "@/app/page-runtime/project-pages-barrier";
import { useProjectPagesRuntimeAdapters } from "@/app/navigation/screen-registry";
import type {
  ProjectPagesRuntimeAdapters,
  ProofreadingPageRuntimeAdapter,
  WorkbenchPageRuntimeAdapter,
} from "@/app/page-runtime/project-pages-runtime-adapter";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";

type ProjectPagesBarrierWaiter = {
  kind: ProjectPagesBarrierKind;
  options: ProjectPagesBarrierOptions;
  resolve: () => void;
};

type ProjectPagesContextValue = {
  proofreading_page_state: ProjectPagesRuntimeAdapters["proofreading_page_state"];
  workbench_live_state: ProjectPagesRuntimeAdapters["workbench_live_state"];
  create_barrier_checkpoint: () => ProjectPagesBarrierCheckpoint;
  wait_for_barrier: (
    kind: ProjectPagesBarrierKind,
    options?: ProjectPagesBarrierOptions,
  ) => Promise<void>;
};

const ProjectPagesContext = createContext<ProjectPagesContextValue | null>(null);

export function ProjectPagesProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_warmup_status, set_project_warmup_status, project_store } =
    useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const project_revision_checkpoint = useMemo(
    () => project_store.getRevisionCheckpoint(),
    [project_store, project_store_state],
  );
  const create_barrier_checkpoint_ref = useRef<() => ProjectPagesBarrierCheckpoint>(() => {
    return createProjectPagesBarrierCheckpoint({
      projectPath: "",
      workbenchConsumedRevisions: {},
      proofreadingConsumedRevisions: {},
    });
  });
  const wait_for_barrier_ref = useRef<
    (
      kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
      options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
    ) => Promise<void>
  >(async () => {});
  const runtime_adapters = useProjectPagesRuntimeAdapters({
    createProjectPagesBarrierCheckpoint: () => create_barrier_checkpoint_ref.current(),
    waitForProjectPagesBarrier: (kind, options) => {
      return wait_for_barrier_ref.current(kind, options);
    },
  });
  const proofreading_page_state = runtime_adapters.proofreading_page_state;
  const workbench_live_state = runtime_adapters.workbench_live_state;
  const previous_project_loaded_ref = useRef(project_snapshot.loaded);
  const previous_project_path_ref = useRef(project_snapshot.path);
  const warmup_target_project_path_ref = useRef("");
  const barrier_waiters_ref = useRef<Set<ProjectPagesBarrierWaiter>>(new Set());

  const workbench_warmup_ready =
    project_snapshot.loaded &&
    !workbench_live_state.is_refreshing &&
    workbench_live_state.settled_project_path === project_snapshot.path;
  const barrier_state = useMemo<ProjectPagesBarrierState>(() => {
    return {
      projectLoaded: project_snapshot.loaded,
      projectPath: project_snapshot.path,
      projectSectionRevisions: project_revision_checkpoint.sections,
      projectWarmupReady: workbench_warmup_ready,
      workbenchFileOpRunning: workbench_live_state.file_op_running,
      workbenchIsRefreshing: workbench_live_state.is_refreshing,
      workbenchConsumedRevisions: workbench_live_state.consumed_revisions,
      workbenchRequiredSections: workbench_live_state.required_sections,
      workbenchSettledProjectPath: workbench_live_state.settled_project_path,
      proofreadingIsRefreshing: proofreading_page_state.is_refreshing,
      proofreadingConsumedRevisions: proofreading_page_state.consumed_revisions,
      proofreadingRequiredSections: proofreading_page_state.required_sections,
      proofreadingSettledProjectPath: proofreading_page_state.settled_project_path,
    };
  }, [
    proofreading_page_state.consumed_revisions,
    proofreading_page_state.is_refreshing,
    proofreading_page_state.required_sections,
    proofreading_page_state.settled_project_path,
    project_revision_checkpoint.sections,
    project_snapshot.loaded,
    project_snapshot.path,
    workbench_live_state.consumed_revisions,
    workbench_live_state.file_op_running,
    workbench_live_state.is_refreshing,
    workbench_live_state.required_sections,
    workbench_live_state.settled_project_path,
    workbench_warmup_ready,
  ]);
  const barrier_state_ref = useRef<ProjectPagesBarrierState>(barrier_state);
  barrier_state_ref.current = barrier_state;

  const create_barrier_checkpoint = useCallback((): ProjectPagesBarrierCheckpoint => {
    const current_barrier_state = barrier_state_ref.current;
    return createProjectPagesBarrierCheckpoint({
      projectPath: current_barrier_state.projectPath,
      workbenchConsumedRevisions: current_barrier_state.workbenchConsumedRevisions,
      proofreadingConsumedRevisions: current_barrier_state.proofreadingConsumedRevisions,
    });
  }, []);

  const resolve_barrier_waiters = useCallback((): void => {
    const current_barrier_state = barrier_state_ref.current;
    const resolved_waiters: ProjectPagesBarrierWaiter[] = [];

    for (const waiter of barrier_waiters_ref.current) {
      if (isProjectPagesBarrierReady(waiter.kind, current_barrier_state, waiter.options)) {
        resolved_waiters.push(waiter);
      }
    }

    for (const waiter of resolved_waiters) {
      barrier_waiters_ref.current.delete(waiter);
      waiter.resolve();
    }
  }, []);

  const wait_for_barrier = useCallback(
    (kind: ProjectPagesBarrierKind, options: ProjectPagesBarrierOptions = {}): Promise<void> => {
      if (isProjectPagesBarrierReady(kind, barrier_state_ref.current, options)) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        barrier_waiters_ref.current.add({
          kind,
          options,
          resolve,
        });
      });
    },
    [],
  );

  create_barrier_checkpoint_ref.current = create_barrier_checkpoint;
  wait_for_barrier_ref.current = (kind, options) => {
    return wait_for_barrier(kind, options);
  };

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      warmup_target_project_path_ref.current = "";
      set_project_warmup_status("idle");
      return;
    }

    const should_restart_warmup =
      project_warmup_status === "warming" &&
      warmup_target_project_path_ref.current !== project_snapshot.path;

    if (
      !previous_project_loaded ||
      previous_project_path !== project_snapshot.path ||
      should_restart_warmup
    ) {
      // 为什么：reset/局部刷新会主动把 warmup 状态切回 warming，但工程路径本身不会变化
      // 这里仍要重新登记目标路径，否则后面的 ready 判定没有锚点，导航会一直卡在 warming
      warmup_target_project_path_ref.current = project_snapshot.path;
      set_project_warmup_status("warming");
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    project_warmup_status,
    set_project_warmup_status,
  ]);

  useEffect(() => {
    if (!project_snapshot.loaded) {
      return;
    }

    const warmup_target_project_path = warmup_target_project_path_ref.current;
    if (warmup_target_project_path === "" || warmup_target_project_path !== project_snapshot.path) {
      return;
    }

    if (workbench_warmup_ready) {
      warmup_target_project_path_ref.current = "";
      set_project_warmup_status("ready");
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    set_project_warmup_status,
    workbench_warmup_ready,
  ]);

  useEffect(() => {
    resolve_barrier_waiters();
  }, [barrier_state, resolve_barrier_waiters]);

  const context_value = useMemo<ProjectPagesContextValue>(() => {
    return {
      proofreading_page_state,
      workbench_live_state,
      create_barrier_checkpoint,
      wait_for_barrier,
    };
  }, [create_barrier_checkpoint, proofreading_page_state, wait_for_barrier, workbench_live_state]);

  return (
    <ProjectPagesContext.Provider value={context_value}>
      {props.children}
    </ProjectPagesContext.Provider>
  );
}

function useProjectPagesContext(): ProjectPagesContextValue {
  const context_value = useContext(ProjectPagesContext);

  if (context_value === null) {
    throw new Error("useProjectPagesContext must be used inside ProjectPagesProvider.");
  }

  return context_value;
}

export function useCachedProofreadingPageState<
  StateType = ProofreadingPageRuntimeAdapter,
>(): StateType {
  return useProjectPagesContext().proofreading_page_state as StateType;
}

export function useCachedWorkbenchLiveState<StateType = WorkbenchPageRuntimeAdapter>(): StateType {
  return useProjectPagesContext().workbench_live_state as StateType;
}

export function useProjectPagesBarrier(): Pick<
  ProjectPagesContextValue,
  "create_barrier_checkpoint" | "wait_for_barrier"
> {
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectPagesContext();

  return {
    create_barrier_checkpoint,
    wait_for_barrier,
  };
}
