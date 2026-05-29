export type TaskSnapshot = {
  run_revision: number;
  task_type: string;
  status: string;
  busy: boolean;
  request_in_flight_count: number;
  progress: TaskProgressSnapshot;
  extras: TranslationTaskExtras | AnalysisTaskExtras;
};

export type TaskLockSnapshot = {
  busy: boolean;
  status: string;
};

export type TaskProgressSnapshot = {
  line: number;
  total_line: number;
  processed_line: number;
  error_line: number;
  total_tokens: number;
  total_output_tokens: number;
  total_input_tokens: number;
  time: number;
  start_time: number;
};

export type TranslationTaskExtras = {
  kind: "translation";
  scope: TranslationTaskScope;
};

export type TranslationTaskScope = { kind: "all" } | { kind: "items"; item_ids: number[] };

export type AnalysisTaskExtras = {
  kind: "analysis";
  candidate_count: number;
};

type TaskSnapshotStoreListener = () => void;

// 默认快照是任务状态唯一空值形状，初始化回到这一份结构
const DEFAULT_TASK_SNAPSHOT: TaskSnapshot = {
  run_revision: 0,
  task_type: "translation",
  status: "idle",
  busy: false,
  request_in_flight_count: 0,
  progress: {
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
  },
  extras: { kind: "translation", scope: { kind: "all" } },
};

/**
 * 归一重翻 item id，避免 SSE 或本地调用把重复、脏类型写入任务状态
 */
function normalize_task_item_ids(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const item_ids: number[] = [];
  const seen_ids = new Set<number>();
  value.forEach((raw_item_id) => {
    const item_id = Number(raw_item_id);
    if (!Number.isInteger(item_id) || item_id <= 0 || seen_ids.has(item_id)) {
      return;
    }

    seen_ids.add(item_id);
    item_ids.push(item_id);
  });
  return item_ids;
}

function normalize_translation_scope(value: unknown): TranslationTaskScope {
  const scope = normalize_record(value);
  if (scope["kind"] !== "items") {
    return { kind: "all" };
  }
  const item_ids = normalize_task_item_ids(scope["item_ids"]);
  return item_ids.length > 0 ? { kind: "items", item_ids } : { kind: "all" };
}

/**
 * 将 Backend task snapshot 响应收窄为 renderer 内部稳定快照
 */
export function normalize_task_snapshot(payload: { task?: Partial<TaskSnapshot> }): TaskSnapshot {
  const snapshot = payload.task ?? {};
  const raw_progress = normalize_record((snapshot as Record<string, unknown>)["progress"]);
  const raw_extras = normalize_record((snapshot as Record<string, unknown>)["extras"]);
  return {
    task_type: String(snapshot.task_type ?? DEFAULT_TASK_SNAPSHOT.task_type),
    run_revision: Number(snapshot.run_revision ?? 0),
    status: String(snapshot.status ?? DEFAULT_TASK_SNAPSHOT.status).toLowerCase(),
    busy: Boolean(snapshot.busy),
    request_in_flight_count: Number(snapshot.request_in_flight_count ?? 0),
    progress: {
      line: Number(raw_progress["line"] ?? 0),
      total_line: Number(raw_progress["total_line"] ?? 0),
      processed_line: Number(raw_progress["processed_line"] ?? 0),
      error_line: Number(raw_progress["error_line"] ?? 0),
      total_tokens: Number(raw_progress["total_tokens"] ?? 0),
      total_output_tokens: Number(raw_progress["total_output_tokens"] ?? 0),
      total_input_tokens: Number(raw_progress["total_input_tokens"] ?? 0),
      time: Number(raw_progress["time"] ?? 0),
      start_time: Number(raw_progress["start_time"] ?? 0),
    },
    extras:
      raw_extras["kind"] === "analysis"
        ? {
            kind: "analysis",
            candidate_count: Number(raw_extras["candidate_count"] ?? 0),
          }
        : {
            kind: "translation",
            scope: normalize_translation_scope(raw_extras["scope"]),
          },
  };
}

function normalize_record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type TaskSnapshotStore = {
  getSnapshot: () => TaskSnapshot;
  subscribe: (listener: TaskSnapshotStoreListener) => () => void;
  applySnapshot: (snapshot: TaskSnapshot) => void;
};

/**
 * 创建 renderer 内唯一任务状态镜像；外部通过 subscribe 读取，不直接改 React state
 */
export function createTaskSnapshotStore(): TaskSnapshotStore {
  let snapshot = DEFAULT_TASK_SNAPSHOT;
  const listeners = new Set<TaskSnapshotStoreListener>();

  // store 内部同步通知订阅者，供 useSyncExternalStore 保持 task_snapshot 派生值一致
  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getSnapshot(): TaskSnapshot {
      return snapshot;
    },
    // 订阅任务快照变更，调用方负责在卸载时释放 listener
    subscribe(listener: TaskSnapshotStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 完整快照来自 HTTP 或 task.snapshot_changed，只接受不旧于当前 revision 的后端事实
    applySnapshot(next_snapshot: TaskSnapshot): void {
      const normalized_snapshot = normalize_task_snapshot({ task: next_snapshot });
      if (normalized_snapshot.run_revision < snapshot.run_revision) {
        return;
      }
      snapshot = normalized_snapshot;
      notify();
    },
  };
}

/**
 * 任务 busy 期间页面写入入口保持只读，防止前端提交和后端任务写回交错。
 */
export function is_project_write_locked(task_snapshot: Pick<TaskLockSnapshot, "busy">): boolean {
  return task_snapshot.busy;
}

/**
 * stopping 是任务终止中的过渡态，工作台任务菜单需要继续展示等待状态。
 */
export function is_task_stopping(task_snapshot: Pick<TaskLockSnapshot, "status">): boolean {
  return task_snapshot.status === "stopping";
}
