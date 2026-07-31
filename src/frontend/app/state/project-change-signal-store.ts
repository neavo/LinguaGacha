import type { ProjectChangeSignal } from "@frontend/app/state/project-change-signal";

const EMPTY_PROJECT_CHANGE_SIGNAL: ProjectChangeSignal = {
  seq: 0,
  reason: "",
  updated_sections: [],
  results: [],
};

/** 创建项目变更的轻量外部 store，使 Provider 不订阅高频页面刷新信号。 */
export function createProjectChangeSignalStore() {
  let snapshot = EMPTY_PROJECT_CHANGE_SIGNAL;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applySnapshot(next_snapshot: ProjectChangeSignal): void {
      snapshot = next_snapshot;
      for (const listener of listeners) listener();
    },
  };
}
