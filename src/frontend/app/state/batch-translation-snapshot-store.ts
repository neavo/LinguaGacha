import type { BatchTranslationSnapshot } from "@domain/batch-translation";
import { create_empty_batch_translation_snapshot } from "@shared/workbench/batch-translation";
import { normalize_batch_translation_snapshot } from "@shared/workbench/batch-translation";

/** renderer 当前批量翻译事实的唯一镜像，HTTP 和 SSE 共用 revision 接收规则。 */
export function createBatchTranslationSnapshotStore() {
  let snapshot = create_empty_batch_translation_snapshot();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applySnapshot: (next: BatchTranslationSnapshot) => {
      const value = normalize_batch_translation_snapshot({ batch_translation: next });
      if (value.revision < snapshot.revision) return;
      snapshot = value;
      for (const listener of listeners) listener();
    },
  };
}
export function is_task_stopping(snapshot: Pick<BatchTranslationSnapshot, "status">): boolean {
  return snapshot.status === "stopping";
}
