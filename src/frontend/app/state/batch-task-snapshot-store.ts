import type { BatchTaskSnapshot } from "@domain/batch-task";
import { empty_batch_task_snapshot } from "@shared/batch-task";
/** 唯一公共任务镜像，业务计数只由后端推进。 */
export function createBatchTaskSnapshotStore() {
  let snapshot = empty_batch_task_snapshot();
  const listeners = new Set<() => void>();
  return {
    // 保持引用稳定，供 React 判断快照是否变化。
    getSnapshot: () => snapshot,
    // 订阅与解除都只影响当前消费者。
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 修订先过滤旧回包，再复制新事实以隔离输入引用。
    applySnapshot: (next: BatchTaskSnapshot) => {
      if (next.revision < snapshot.revision) return;
      snapshot = structuredClone(next);
      for (const listener of listeners) listener();
    },
  };
}
