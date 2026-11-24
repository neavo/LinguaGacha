import type { ProjectActivity, RuntimeActivitySnapshot } from "@shared/runtime-activity";
import { is_json_record } from "@domain/json";

const DEFAULT_RUNTIME_ACTIVITY_SNAPSHOT: RuntimeActivitySnapshot = {
  revision: 0,
  owner: null,
};

/** 将 HTTP / SSE 不可信载荷收窄为 renderer 唯一运行占用形状。 */
function normalize_runtime_activity_snapshot(value: unknown): RuntimeActivitySnapshot {
  const runtime = is_json_record(value) ? value : {};
  const revision = runtime["revision"];
  const owner = runtime["owner"];
  const projects: Record<string, ProjectActivity> = {};
  if (is_json_record(runtime.projects)) {
    for (const [id, project] of Object.entries(runtime.projects)) {
      if (!is_json_record(project)) continue;
      projects[id] = {
        batchTranslation: project.batchTranslation === true,
        activeChatCount: typeof project.activeChatCount === "number" ? project.activeChatCount : 0,
        projectWrite: project.projectWrite === true,
      };
    }
  }
  return {
    revision:
      typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
        ? revision
        : 0,
    global: { modelTest: is_json_record(runtime.global) && runtime.global.modelTest === true },
    projects,
    owner:
      owner === "batch_translation" ||
      owner === "agent" ||
      owner === "model_test" ||
      owner === "project_write"
        ? owner
        : null,
  };
}

/** 创建 renderer 内的运行占用镜像，并用后端 revision 抵御 HTTP / SSE 乱序。 */
export function createRuntimeActivityStore(): {
  getSnapshot: () => RuntimeActivitySnapshot;
  subscribe: (listener: () => void) => () => void;
  applySnapshot: (snapshot: unknown) => void;
} {
  let snapshot = DEFAULT_RUNTIME_ACTIVITY_SNAPSHOT;
  const listeners = new Set<() => void>();

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
      const normalized_snapshot = normalize_runtime_activity_snapshot(next_snapshot);
      if (normalized_snapshot.revision < snapshot.revision) return;
      snapshot = normalized_snapshot;
      for (const listener of listeners) listener();
    },
  };
}

/** 工程写入与额外执行受运行占用约束，纯配置和查询不消费此限制。 */
export function is_runtime_busy(snapshot: Pick<RuntimeActivitySnapshot, "owner">): boolean {
  return snapshot.owner !== null;
}
