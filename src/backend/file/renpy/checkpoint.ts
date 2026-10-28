import { setImmediate } from "node:timers/promises";

const WALK_BATCH_SIZE = 2048;

/** 入口与批次恢复时检查取消。普通节点保持同步，避免逐节点创建 Promise。 */
export function create_checkpoint(signal?: AbortSignal): () => Promise<void> | undefined {
  signal?.throwIfAborted();
  let remaining = WALK_BATCH_SIZE;
  return () => {
    if (--remaining > 0) return undefined;
    remaining = WALK_BATCH_SIZE;
    return setImmediate().then(() => signal?.throwIfAborted());
  };
}
