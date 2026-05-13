export type TaskSnapshot = {
  task_type: string;
  status: string;
  busy: boolean;
  request_in_flight_count: number;
  progress: TaskProgressSnapshot;
  extras: TranslationTaskExtras | AnalysisTaskExtras;
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

export type TranslationTaskScope =
  | { kind: "all" }
  | { kind: "items"; item_ids: number[] };

export type AnalysisTaskExtras = {
  kind: "analysis";
  candidate_count: number;
};

type TaskRuntimeStoreListener = () => void;

// 默认快照是任务运行态唯一空值形状，初始化回到这一份结构
const DEFAULT_TASK_SNAPSHOT: TaskSnapshot = {
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
 * 归一重翻 item id，避免 SSE 或本地调用把重复、脏类型写入任务运行态
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
 * 将 Core task snapshot 响应收窄为 renderer 内部稳定快照
 */
export function normalize_task_snapshot(payload: { task?: Partial<TaskSnapshot> }): TaskSnapshot {
  const snapshot = payload.task ?? {};
  const raw_progress = normalize_record((snapshot as Record<string, unknown>)["progress"]);
  const raw_extras = normalize_record((snapshot as Record<string, unknown>)["extras"]);
  return {
    task_type: String(snapshot.task_type ?? DEFAULT_TASK_SNAPSHOT.task_type),
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

type TaskRuntimeStore = {
  getSnapshot: () => TaskSnapshot;
  subscribe: (listener: TaskRuntimeStoreListener) => () => void;
  applySnapshot: (snapshot: TaskSnapshot) => void;
};

/**
 * 创建 renderer 内唯一任务运行态镜像；外部通过 subscribe 读取，不直接改 React state
 */
export function createTaskRuntimeStore(): TaskRuntimeStore {
  let snapshot = DEFAULT_TASK_SNAPSHOT;
  const listeners = new Set<TaskRuntimeStoreListener>();

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
    subscribe(listener: TaskRuntimeStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 完整快照来自 HTTP 或 task.snapshot_changed，必须覆盖当前任务运行态
    applySnapshot(next_snapshot: TaskSnapshot): void {
      snapshot = normalize_task_snapshot({ task: next_snapshot });
      notify();
    },
  };
}
