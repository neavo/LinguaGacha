import type { BatchTaskListSnapshot, BatchTranslationCompletion } from "@domain/batch-task";
import { empty_batch_task_list_snapshot } from "@shared/batch-task";

/** 工程打开期间接收实时快照，并只交接本次会话已受理的独立翻译。 */
export function createBatchTaskSnapshotStore() {
  let snapshot = empty_batch_task_list_snapshot();
  let observed_run_id: string | undefined;
  let handled_run_id: string | undefined;
  let completion: BatchTranslationCompletion | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    /** 完成通知和导出只消费一次回执。 */
    takeTranslationCompletion: () => {
      const pending = completion;
      completion = null;
      return pending;
    },
    /** 订阅同一工程打开周期的批次更新。 */
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 较旧的启动回包仍可确认受理身份，但不能回退已收到的快照。 */
    applySnapshot: (next: BatchTaskListSnapshot, accepted_run_id?: string) => {
      const newer = next.revision > snapshot.revision || snapshot.project_path === "";
      const current = newer ? next : snapshot;
      const receipt = current.last_translation;
      const accepted_completion =
        receipt !== null &&
        receipt.run_id !== handled_run_id &&
        (receipt.run_id === observed_run_id || receipt.run_id === accepted_run_id);

      observed_run_id =
        current.tasks.find((task) => task.kind === "translation" && task.source === "standalone")
          ?.run_id ?? observed_run_id;
      if (!newer && !accepted_completion) return;
      snapshot = newer ? structuredClone(next) : { ...snapshot }; // 只有回执受理时也通知 React 消费。
      if (accepted_completion) {
        completion = snapshot.last_translation;
        handled_run_id = receipt.run_id;
      }
      for (const listener of listeners) listener();
    },
  };
}
