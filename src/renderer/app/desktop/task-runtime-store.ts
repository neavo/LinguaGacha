export type TaskSnapshot = {
  task_type: string;
  status: string;
  busy: boolean;
  request_in_flight_count: number;
  line: number;
  total_line: number;
  processed_line: number;
  error_line: number;
  total_tokens: number;
  total_output_tokens: number;
  total_input_tokens: number;
  time: number;
  start_time: number;
  analysis_candidate_count: number;
  retranslating_item_ids: number[];
};

type TaskRuntimeStoreListener = () => void;

// 默认快照是任务运行态唯一空值形状，初始化回到这一份结构
const DEFAULT_TASK_SNAPSHOT: TaskSnapshot = {
  task_type: "translation",
  status: "IDLE",
  busy: false,
  request_in_flight_count: 0,
  line: 0,
  total_line: 0,
  processed_line: 0,
  error_line: 0,
  total_tokens: 0,
  total_output_tokens: 0,
  total_input_tokens: 0,
  time: 0,
  start_time: 0,
  analysis_candidate_count: 0,
  retranslating_item_ids: [],
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

/**
 * 将 Core task snapshot 响应收窄为 renderer 内部稳定快照
 */
export function normalize_task_snapshot(payload: { task?: Partial<TaskSnapshot> }): TaskSnapshot {
  const snapshot = payload.task ?? {};
  return {
    task_type: String(snapshot.task_type ?? DEFAULT_TASK_SNAPSHOT.task_type),
    status: String(snapshot.status ?? DEFAULT_TASK_SNAPSHOT.status),
    busy: Boolean(snapshot.busy),
    request_in_flight_count: Number(snapshot.request_in_flight_count ?? 0),
    line: Number(snapshot.line ?? 0),
    total_line: Number(snapshot.total_line ?? 0),
    processed_line: Number(snapshot.processed_line ?? 0),
    error_line: Number(snapshot.error_line ?? 0),
    total_tokens: Number(snapshot.total_tokens ?? 0),
    total_output_tokens: Number(snapshot.total_output_tokens ?? 0),
    total_input_tokens: Number(snapshot.total_input_tokens ?? 0),
    time: Number(snapshot.time ?? 0),
    start_time: Number(snapshot.start_time ?? 0),
    analysis_candidate_count: Number(snapshot.analysis_candidate_count ?? 0),
    retranslating_item_ids: normalize_task_item_ids(snapshot.retranslating_item_ids),
  };
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
      snapshot = {
        ...next_snapshot,
        retranslating_item_ids: normalize_task_item_ids(next_snapshot.retranslating_item_ids),
      };
      notify();
    },
  };
}
