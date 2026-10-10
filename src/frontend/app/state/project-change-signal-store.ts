import type { ProjectChangeSignal } from "@frontend/app/state/project-change-signal";

const EMPTY_PROJECT_CHANGE_SIGNAL: ProjectChangeSignal = {
  seq: 0,
  reason: "",
  updated_sections: [],
  results: [],
};

/** 创建同步变更 Store，使 `DesktopStateProvider` 无需随高频信号重渲染。 */
export function createProjectChangeSignalStore() {
  let snapshot = EMPTY_PROJECT_CHANGE_SIGNAL; // 只保留最新通知，逐次发布由同步订阅消费。
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot, // 消费者读取相同通知基线。
    /** 订阅期间每次发布都同步触达消费者。 */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 发布先切换快照，再通知全部订阅者。 */
    applySnapshot(next_snapshot: ProjectChangeSignal): void {
      snapshot = next_snapshot;
      for (const listener of listeners) listener();
    },
  };
}

/** 订阅者共享同一实例，只读取快照和同步通知。 */
export type ProjectChangeSignalSource = Readonly<
  Pick<ReturnType<typeof createProjectChangeSignalStore>, "getSnapshot" | "subscribe">
>;
