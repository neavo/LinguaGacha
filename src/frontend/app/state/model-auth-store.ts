import { useSyncExternalStore } from "react";
import type { ChatGPTAuthSnapshot } from "@shared/model-auth";

let snapshot: ChatGPTAuthSnapshot | null = null;
const listeners = new Set<() => void>();

/** HTTP 回包与 SSE 使用同一账户及授权摘要，迟到回包不能覆盖新结果。 */
export function apply_model_auth_snapshot(next: ChatGPTAuthSnapshot): boolean {
  if (snapshot?.instance_id === next.instance_id && snapshot.revision > next.revision) return false;
  snapshot = next;
  for (const listener of listeners) listener();
  return true;
}

/** 页面与条目共享同一只读账户状态，卸载时解除订阅。 */
export function useModelAuthSnapshot(): ChatGPTAuthSnapshot | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}
