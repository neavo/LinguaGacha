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

/**
 * status 事件只更新任务状态类字段，保留进度计数的最新值
 */
function merge_task_status_update(
  previous_snapshot: TaskSnapshot,
  payload: Partial<TaskSnapshot>,
): TaskSnapshot {
  return {
    ...previous_snapshot,
    task_type:
      payload.task_type === undefined ? previous_snapshot.task_type : String(payload.task_type),
    status: payload.status === undefined ? previous_snapshot.status : String(payload.status),
    busy: payload.busy === undefined ? previous_snapshot.busy : Boolean(payload.busy),
    retranslating_item_ids:
      payload.retranslating_item_ids === undefined
        ? previous_snapshot.retranslating_item_ids
        : normalize_task_item_ids(payload.retranslating_item_ids),
  };
}

/**
 * progress 事件只推进进度类字段，避免高频事件覆盖 status 事件刚写入的 busy 状态
 */
function merge_task_progress_update(
  previous_snapshot: TaskSnapshot,
  payload: Partial<TaskSnapshot>,
): TaskSnapshot {
  return {
    ...previous_snapshot,
    task_type:
      payload.task_type === undefined ? previous_snapshot.task_type : String(payload.task_type),
    request_in_flight_count:
      payload.request_in_flight_count === undefined
        ? previous_snapshot.request_in_flight_count
        : Number(payload.request_in_flight_count),
    line: payload.line === undefined ? previous_snapshot.line : Number(payload.line),
    total_line:
      payload.total_line === undefined ? previous_snapshot.total_line : Number(payload.total_line),
    processed_line:
      payload.processed_line === undefined
        ? previous_snapshot.processed_line
        : Number(payload.processed_line),
    error_line:
      payload.error_line === undefined ? previous_snapshot.error_line : Number(payload.error_line),
    total_tokens:
      payload.total_tokens === undefined
        ? previous_snapshot.total_tokens
        : Number(payload.total_tokens),
    total_output_tokens:
      payload.total_output_tokens === undefined
        ? previous_snapshot.total_output_tokens
        : Number(payload.total_output_tokens),
    total_input_tokens:
      payload.total_input_tokens === undefined
        ? previous_snapshot.total_input_tokens
        : Number(payload.total_input_tokens),
    time: payload.time === undefined ? previous_snapshot.time : Number(payload.time),
    start_time:
      payload.start_time === undefined ? previous_snapshot.start_time : Number(payload.start_time),
    analysis_candidate_count:
      payload.analysis_candidate_count === undefined
        ? previous_snapshot.analysis_candidate_count
        : Number(payload.analysis_candidate_count),
    retranslating_item_ids:
      payload.retranslating_item_ids === undefined
        ? previous_snapshot.retranslating_item_ids
        : normalize_task_item_ids(payload.retranslating_item_ids),
  };
}

type TaskRuntimeStore = {
  getSnapshot: () => TaskSnapshot;
  subscribe: (listener: TaskRuntimeStoreListener) => () => void;
  applySnapshot: (snapshot: TaskSnapshot) => void;
  applyStatusEvent: (payload: Partial<TaskSnapshot>) => void;
  applyProgressEvent: (payload: Partial<TaskSnapshot>) => void;
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
    // 完整快照来自 HTTP snapshot，必须覆盖当前任务运行态
    applySnapshot(next_snapshot: TaskSnapshot): void {
      snapshot = {
        ...next_snapshot,
        retranslating_item_ids: normalize_task_item_ids(next_snapshot.retranslating_item_ids),
      };
      notify();
    },
    // task.status_changed 只走状态合并，避免丢掉进度字段
    applyStatusEvent(payload: Partial<TaskSnapshot>): void {
      snapshot = merge_task_status_update(snapshot, payload);
      notify();
    },
    // task.progress_changed 高频写入只走进度合并
    applyProgressEvent(payload: Partial<TaskSnapshot>): void {
      snapshot = merge_task_progress_update(snapshot, payload);
      notify();
    },
  };
}
