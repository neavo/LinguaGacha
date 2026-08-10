import { useContext, useSyncExternalStore } from "react";

import {
  DesktopStateContext,
  DesktopStateStoresContext,
} from "@frontend/app/state/desktop-state-context";

export function useDesktopState() {
  const context_value = useContext(DesktopStateContext);

  if (context_value === null) {
    throw new Error("useDesktopState must be used inside DesktopStateProvider.");
  }

  return context_value;
}

/** 高频快照统一从稳定 stores context 取源，避免主 DesktopStateContext 被动刷新。 */
function useDesktopStateStores() {
  const stores = useContext(DesktopStateStoresContext);
  if (stores === null) throw new Error("Desktop state stores require a Provider.");
  return stores;
}

/** 只订阅完整任务快照。 */
export function useTaskSnapshot() {
  const store = useDesktopStateStores().task;
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 只订阅全局运行占用快照。 */
export function useRuntimeSnapshot() {
  const store = useDesktopStateStores().runtime;
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 只订阅项目 section 变更信号。 */
export function useProjectChangeSignal() {
  const store = useDesktopStateStores().projectChange;
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 返回 task store 的稳定写入口，供命令 ack 与 SSE 同步。 */
export function useSyncTaskSnapshot() {
  return useDesktopStateStores().task.applySnapshot;
}
