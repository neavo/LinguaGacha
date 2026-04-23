import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import {
  createProjectPagesBarrierCheckpoint,
  isProjectPagesBarrierReady,
  type ProjectPagesBarrierCheckpoint,
  type ProjectPagesBarrierKind,
  type ProjectPagesBarrierOptions,
  type ProjectPagesBarrierState,
} from "@/app/state/project-pages-barrier";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";
import { useProofreadingPageState } from "@/pages/proofreading-page/use-proofreading-page-state";
import { useWorkbenchLiveState } from "@/pages/workbench-page/use-workbench-live-state";

type ProjectPagesBarrierWaiter = {
  kind: ProjectPagesBarrierKind;
  options: ProjectPagesBarrierOptions;
  resolve: () => void;
};

type ProjectPagesContextValue = {
  proofreading_page_state: ReturnType<typeof useProofreadingPageState>;
  workbench_live_state: ReturnType<typeof useWorkbenchLiveState>;
  create_barrier_checkpoint: () => ProjectPagesBarrierCheckpoint;
  wait_for_barrier: (
    kind: ProjectPagesBarrierKind,
    options?: ProjectPagesBarrierOptions,
  ) => Promise<void>;
};

const ProjectPagesContext = createContext<ProjectPagesContextValue | null>(null);

export function ProjectPagesProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_warmup_status, set_project_warmup_status } =
    useDesktopRuntime();
  const create_barrier_checkpoint_ref = useRef<() => ProjectPagesBarrierCheckpoint>(() => {
    return createProjectPagesBarrierCheckpoint({
      projectPath: "",
      workbenchLastLoadedAt: null,
      proofreadingLastLoadedAt: null,
    });
  });
  const wait_for_barrier_ref = useRef<
    (
      kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
      options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
    ) => Promise<void>
  >(async () => {});
  const proofreading_page_state = useProofreadingPageState();
  const workbench_live_state = useWorkbenchLiveState({
    createProjectPagesBarrierCheckpoint: () => create_barrier_checkpoint_ref.current(),
    waitForProjectPagesBarrier: (kind, options) => {
      return wait_for_barrier_ref.current(kind, options);
    },
  });
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
      projectWarmupReady: workbench_warmup_ready,
      workbenchFileOpRunning: workbench_live_state.file_op_running,
      workbenchCacheStale: workbench_live_state.cache_stale,
      workbenchIsRefreshing: workbench_live_state.is_refreshing,
      workbenchLastLoadedAt: workbench_live_state.last_loaded_at,
      workbenchSettledProjectPath: workbench_live_state.settled_project_path,
      proofreadingCacheStale: proofreading_page_state.cache_stale,
      proofreadingIsRefreshing: proofreading_page_state.is_refreshing,
      proofreadingLastLoadedAt: proofreading_page_state.last_loaded_at,
      proofreadingSettledProjectPath: proofreading_page_state.settled_project_path,
    };
  }, [
    proofreading_page_state.cache_stale,
    proofreading_page_state.is_refreshing,
    proofreading_page_state.last_loaded_at,
    proofreading_page_state.settled_project_path,
    project_snapshot.loaded,
    project_snapshot.path,
    workbench_live_state.cache_stale,
    workbench_live_state.file_op_running,
    workbench_live_state.is_refreshing,
    workbench_live_state.last_loaded_at,
    workbench_live_state.settled_project_path,
    workbench_warmup_ready,
  ]);
  const barrier_state_ref = useRef<ProjectPagesBarrierState>(barrier_state);
  barrier_state_ref.current = barrier_state;

  const create_barrier_checkpoint = useCallback((): ProjectPagesBarrierCheckpoint => {
    const current_barrier_state = barrier_state_ref.current;
    return createProjectPagesBarrierCheckpoint({
      projectPath: current_barrier_state.projectPath,
      workbenchLastLoadedAt: current_barrier_state.workbenchLastLoadedAt,
      proofreadingLastLoadedAt: current_barrier_state.proofreadingLastLoadedAt,
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
      // 为什么：reset/局部刷新会主动把 warmup 状态切回 warming，但工程路径本身不会变化。
      // 这里仍要重新登记目标路径，否则后面的 ready 判定没有锚点，导航会一直卡在 warming。
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
    throw new Error("useProjectPagesContext 必须在 ProjectPagesProvider 内使用。");
  }

  return context_value;
}

export function useCachedProofreadingPageState(): ReturnType<typeof useProofreadingPageState> {
  return useProjectPagesContext().proofreading_page_state;
}

export function useCachedWorkbenchLiveState(): ReturnType<typeof useWorkbenchLiveState> {
  return useProjectPagesContext().workbench_live_state;
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
