import type { BatchTranslationSnapshot } from "@domain/batch-translation";
import {
  create_empty_batch_translation_snapshot,
  should_open_translation_export_followup,
} from "@shared/batch-translation/batch-translation";

/** renderer 当前批量翻译事实的唯一镜像，HTTP 和 SSE 共用 revision 接收规则。 */
export function createBatchTranslationSnapshotStore() {
  let snapshot = create_empty_batch_translation_snapshot();
  let export_pending = false;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    takeExportFollowup: () => {
      const pending = export_pending;
      export_pending = false;
      return pending;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applySnapshot: (value: BatchTranslationSnapshot) => {
      if (value.revision < snapshot.revision) return;
      if (should_open_translation_export_followup(snapshot.status, value)) export_pending = true;
      else if (value.run_id !== snapshot.run_id || value.status !== "done") export_pending = false;
      snapshot = value;
      for (const listener of listeners) listener();
    },
  };
}
/** 停止收尾期间由后端状态锁定重复操作。 */
export function is_task_stopping(snapshot: Pick<BatchTranslationSnapshot, "status">): boolean {
  return snapshot.status === "stopping";
}
