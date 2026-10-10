import type { ProjectChangeSignalSource } from "./project-change-signal-store";
import { useContext, useSyncExternalStore } from "react";

import {
  DesktopStateContext,
  DesktopStateStoresContext,
} from "@frontend/app/state/desktop-state-context";

/** 主窗口会话与设置统一从当前 Provider 读取。 */
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
export function useBatchTranslationSnapshot() {
  const store = useDesktopStateStores().batch_translation;
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 只订阅全局运行占用快照。 */
export function useRuntimeSnapshot() {
  const store = useDesktopStateStores().runtime;
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 只订阅项目 section 变更信号。 */
export function useProjectChangeSignal() {
  const store = useProjectChangeSignalSource();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 返回 task store 的稳定写入口，供命令 ack 与 SSE 同步。 */
export function useSyncBatchTranslationSnapshot() {
  return useDesktopStateStores().batch_translation.applySnapshot;
}

/** 返回稳定的只读变更源，供生命周期消费者同步处理每次发布。 */
export function useProjectChangeSignalSource(): ProjectChangeSignalSource {
  return useDesktopStateStores().projectChange;
}
