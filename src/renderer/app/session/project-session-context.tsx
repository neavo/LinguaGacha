import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createProjectSessionBarrierCheckpoint,
  isProjectSessionBarrierReady,
  type ProjectSessionBarrierCheckpoint,
  type ProjectSessionBarrierKind,
  type ProjectSessionBarrierOptions,
  type ProjectSessionBarrierState,
  type ProjectSessionPageCacheKind,
  type ProjectSessionPageCacheSnapshot,
} from "@/app/session/project-session-barrier";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";

type ProjectSessionBarrierWaiter = {
  kind: ProjectSessionBarrierKind; // waiter 等待的稳定 barrier 语义
  options: ProjectSessionBarrierOptions; // options 锚定目标项目或调用方 checkpoint
  resolve: () => void; // resolve 只在 barrier 满足时调用一次
};

type ProjectSessionPageCacheRegistration = {
  update: (snapshot: ProjectSessionPageCacheSnapshot) => void; // update 推进已挂载页面缓存状态
  unregister: () => void; // unregister 在页面卸载时移除缓存义务
};

type RegisteredPageCache = {
  id: symbol; // id 防止旧 effect 清理误删新挂载的同类页面缓存
  snapshot: ProjectSessionPageCacheSnapshot; // snapshot 是 barrier 判定的只读输入
};

type ProjectSessionContextValue = {
  create_barrier_checkpoint: () => ProjectSessionBarrierCheckpoint; // create_barrier_checkpoint 固定当前项目身份
  wait_for_barrier: (
    kind: ProjectSessionBarrierKind,
    options?: ProjectSessionBarrierOptions,
  ) => Promise<void>; // wait_for_barrier 等待 session 或已挂载页面缓存到达 ready
  register_page_cache: (
    kind: ProjectSessionPageCacheKind,
    snapshot: ProjectSessionPageCacheSnapshot,
  ) => ProjectSessionPageCacheRegistration; // register_page_cache 在页面生命周期内登记缓存义务
};

const ProjectSessionContext = createContext<ProjectSessionContextValue | null>(null);

// ProjectSessionProvider 只协调项目 session 和已挂载页面缓存，不创建任何页面 runtime。
export function ProjectSessionProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_session_status, project_store } = useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const project_revision_checkpoint = useMemo(
    () => project_store.getRevisionCheckpoint(),
    [project_store, project_store_state],
  );
  // page_cache_registry_ref 是已挂载页面缓存的唯一登记表，未挂载页面不能继续构成等待义务。
  const page_cache_registry_ref = useRef<Map<ProjectSessionPageCacheKind, RegisteredPageCache>>(
    new Map(),
  );
  const [page_cache_revision, set_page_cache_revision] = useState(0);
  const barrier_waiters_ref = useRef<Set<ProjectSessionBarrierWaiter>>(new Set()); // barrier_waiters_ref 保存尚未满足的异步等待

  // barrier_state 是等待判定的不可变视图，避免 waiter 直接读取多个可变 ref。
  const barrier_state = useMemo<ProjectSessionBarrierState>(() => {
    const pageCaches: ProjectSessionBarrierState["pageCaches"] = {};
    for (const [kind, registration] of page_cache_registry_ref.current.entries()) {
      pageCaches[kind] = registration.snapshot;
    }

    return {
      projectLoaded: project_snapshot.loaded,
      projectPath: project_snapshot.path,
      projectSectionRevisions: project_revision_checkpoint.sections,
      projectSessionReady: project_session_status === "ready",
      pageCaches,
    };
  }, [
    page_cache_revision,
    project_revision_checkpoint.sections,
    project_session_status,
    project_snapshot.loaded,
    project_snapshot.path,
  ]);
  const barrier_state_ref = useRef<ProjectSessionBarrierState>(barrier_state);
  barrier_state_ref.current = barrier_state;

  // bump_page_cache_revision 让 ref 中的页面缓存变化进入 React 依赖图。
  const bump_page_cache_revision = useCallback((): void => {
    set_page_cache_revision((previous_revision) => previous_revision + 1);
  }, []);

  const register_page_cache = useCallback(
    (
      kind: ProjectSessionPageCacheKind,
      snapshot: ProjectSessionPageCacheSnapshot,
    ): ProjectSessionPageCacheRegistration => {
      const id = Symbol(kind);
      page_cache_registry_ref.current.set(kind, { id, snapshot });
      bump_page_cache_revision();

      return {
        update(next_snapshot: ProjectSessionPageCacheSnapshot): void {
          const current_registration = page_cache_registry_ref.current.get(kind);
          if (current_registration?.id !== id) {
            return;
          }

          page_cache_registry_ref.current.set(kind, {
            id,
            snapshot: next_snapshot,
          });
          bump_page_cache_revision();
        },
        unregister(): void {
          const current_registration = page_cache_registry_ref.current.get(kind);
          if (current_registration?.id !== id) {
            return;
          }

          page_cache_registry_ref.current.delete(kind);
          bump_page_cache_revision();
        },
      };
    },
    [bump_page_cache_revision],
  );

  const create_barrier_checkpoint = useCallback((): ProjectSessionBarrierCheckpoint => {
    return createProjectSessionBarrierCheckpoint({
      projectPath: barrier_state_ref.current.projectPath,
    });
  }, []);

  // resolve_barrier_waiters 只解析当前满足的 waiter，避免遍历中修改 Set 造成漏通知。
  const resolve_barrier_waiters = useCallback((): void => {
    const current_barrier_state = barrier_state_ref.current;
    const resolved_waiters: ProjectSessionBarrierWaiter[] = [];

    for (const waiter of barrier_waiters_ref.current) {
      if (isProjectSessionBarrierReady(waiter.kind, current_barrier_state, waiter.options)) {
        resolved_waiters.push(waiter);
      }
    }

    for (const waiter of resolved_waiters) {
      barrier_waiters_ref.current.delete(waiter);
      waiter.resolve();
    }
  }, []);

  const wait_for_barrier = useCallback(
    (
      kind: ProjectSessionBarrierKind,
      options: ProjectSessionBarrierOptions = {},
    ): Promise<void> => {
      if (isProjectSessionBarrierReady(kind, barrier_state_ref.current, options)) {
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

  useEffect(() => {
    resolve_barrier_waiters();
  }, [barrier_state, resolve_barrier_waiters]);

  const context_value = useMemo<ProjectSessionContextValue>(() => {
    return {
      create_barrier_checkpoint,
      wait_for_barrier,
      register_page_cache,
    };
  }, [create_barrier_checkpoint, register_page_cache, wait_for_barrier]);

  return (
    <ProjectSessionContext.Provider value={context_value}>
      {props.children}
    </ProjectSessionContext.Provider>
  );
}

// useProjectSessionContext 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
function useProjectSessionContext(): ProjectSessionContextValue {
  const context_value = useContext(ProjectSessionContext);

  if (context_value === null) {
    throw new Error("useProjectSessionContext must be used inside ProjectSessionProvider.");
  }

  return context_value;
}

/**
 * 页面挂载期间把本页缓存状态注册到 session barrier，卸载时自动释放义务。
 */
export function useProjectSessionPageCacheRegistration(
  kind: ProjectSessionPageCacheKind,
  snapshot: ProjectSessionPageCacheSnapshot,
): void {
  const { register_page_cache } = useProjectSessionContext();
  const latest_snapshot_ref = useRef(snapshot);
  const registration_ref = useRef<ProjectSessionPageCacheRegistration | null>(null);
  latest_snapshot_ref.current = snapshot;

  useEffect(() => {
    const registration = register_page_cache(kind, latest_snapshot_ref.current);
    registration_ref.current = registration;

    return () => {
      registration.unregister();
      if (registration_ref.current === registration) {
        registration_ref.current = null;
      }
    };
  }, [kind, register_page_cache]);

  useEffect(() => {
    registration_ref.current?.update(snapshot);
  }, [snapshot]);
}

/**
 * 暴露给页面动作的 barrier API；页面无需知道其它页面是否已挂载。
 */
export function useProjectSessionBarrier(): Pick<
  ProjectSessionContextValue,
  "create_barrier_checkpoint" | "wait_for_barrier"
> {
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectSessionContext();

  return {
    create_barrier_checkpoint,
    wait_for_barrier,
  };
}
