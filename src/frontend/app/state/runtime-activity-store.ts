import type { RuntimeActivitySnapshot } from "@shared/runtime-activity";

type RuntimeActivityListener = () => void;

export type RuntimeActivityPayload = {
  runtime?: unknown;
};

const DEFAULT_RUNTIME_ACTIVITY_SNAPSHOT: RuntimeActivitySnapshot = {
  revision: 0,
  owner: null,
};

/** 将 HTTP / SSE 不可信载荷收窄为 renderer 唯一运行占用形状。 */
export function normalize_runtime_activity_snapshot(
  payload: RuntimeActivityPayload,
): RuntimeActivitySnapshot {
  const runtime =
    typeof payload.runtime === "object" &&
    payload.runtime !== null &&
    !Array.isArray(payload.runtime)
      ? (payload.runtime as Record<string, unknown>)
      : {};
  const revision = runtime["revision"];
  const owner = runtime["owner"];
  return {
    revision:
      typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
        ? revision
        : 0,
    owner: owner === "batch_translation" || owner === "agent" ? owner : null,
  };
}

/** 创建 renderer 内的运行占用镜像，并用后端 revision 抵御 HTTP / SSE 乱序。 */
export function createRuntimeActivityStore(): {
  getSnapshot: () => RuntimeActivitySnapshot;
  subscribe: (listener: RuntimeActivityListener) => () => void;
  applySnapshot: (snapshot: RuntimeActivitySnapshot) => void;
} {
  let snapshot = DEFAULT_RUNTIME_ACTIVITY_SNAPSHOT;
  const listeners = new Set<RuntimeActivityListener>();

  return {
    // useSyncExternalStore 读取同一对象引用，只有实际应用快照时才替换。
    getSnapshot: () => snapshot,
    // 订阅者由 React 生命周期释放，store 不持有组件状态。
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // 相同 revision 允许后到的完整快照覆盖，语义与 task store 一致。
    applySnapshot(next_snapshot): void {
      const normalized_snapshot = normalize_runtime_activity_snapshot({ runtime: next_snapshot });
      if (normalized_snapshot.revision < snapshot.revision) return;
      snapshot = normalized_snapshot;
      for (const listener of listeners) listener();
    },
  };
}

/** owner 是否存在是所有页面写锁的唯一判断。 */
export function is_runtime_busy(snapshot: Pick<RuntimeActivitySnapshot, "owner">): boolean {
  return snapshot.owner !== null;
}
