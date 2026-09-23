import { useSyncExternalStore } from "react";
import type { ModelCatalogSnapshot } from "@shared/model-catalog";

let revision = 0;
let started_at = 0;
let instance_id = "";
const listeners = new Set<() => void>();

/** SSE 与重新连接的快照共用修订裁决，页面只订阅轻量目录标记。 */
export function apply_model_catalog_revision(value: unknown): boolean {
  const next =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<keyof ModelCatalogSnapshot, unknown>>)
      : {};
  if (
    typeof next.revision !== "number" ||
    !Number.isSafeInteger(next.revision) ||
    next.revision < 0 ||
    typeof next.started_at !== "number" ||
    !Number.isSafeInteger(next.started_at) ||
    typeof next.instance_id !== "string" ||
    next.instance_id === ""
  )
    return false;
  if (
    next.started_at < started_at ||
    (next.started_at === started_at && next.instance_id !== instance_id && instance_id !== "")
  )
    return false;
  if (next.instance_id === instance_id && next.revision <= revision) return false;
  instance_id = next.instance_id;
  started_at = next.started_at;
  revision = next.revision;
  for (const listener of listeners) listener();
  if (revision === 0) return false;
  const notice_key = `pi-model-catalog:${instance_id}:${revision}`;
  try {
    if (sessionStorage.getItem(notice_key) !== null) return false;
    sessionStorage.setItem(notice_key, "1");
  } catch {
    // 会话存储不可用时，当前窗口仍通过内存修订去重。
  }
  return true;
}

/** 后端实例变化也会刷新页面，即使两次启动的修订号相同。 */
export function useModelCatalogRevision(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => `${instance_id}:${revision}`,
  );
}
