export type WorkbenchTaskSnapshot = {
  run_revision: number;
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
  total_reasoning_tokens: number; // 后端累计思考 token
  total_input_tokens: number;
  time: number;
  start_time: number;
};

export type WorkbenchTaskSnapshotPayload = Partial<WorkbenchTaskSnapshot> & {
  progress?: Partial<WorkbenchTaskSnapshot>;
};

export type WorkbenchTaskMetrics = {
  active: boolean;
  stopping: boolean;
  completion_percent: number;
  processed_count: number;
  failed_count: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  average_output_speed: number;
  input_tokens: number;
  reasoning_tokens: number; // 详情展示的累计思考 token
  output_tokens: number; // 详情展示的累计输出 token
  request_in_flight_count: number;
};

/**
 * 两类工作台任务共享同一空运行态，领域包装只追加各自 extras。
 */
export function create_empty_workbench_task_snapshot(task_type: string): WorkbenchTaskSnapshot {
  return {
    run_revision: 0,
    task_type,
    status: "idle",
    busy: false,
    request_in_flight_count: 0,
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_reasoning_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
  };
}

/**
 * 快照元信息始终取顶层，进度字段兼容后端嵌套 progress 载荷。
 */
export function normalize_workbench_task_snapshot_payload(
  snapshot: WorkbenchTaskSnapshotPayload,
  default_task_type: string,
): WorkbenchTaskSnapshot {
  const progress = snapshot.progress ?? snapshot;
  return {
    run_revision: Number(snapshot.run_revision ?? 0),
    task_type: String(snapshot.task_type ?? default_task_type),
    status: String(snapshot.status ?? "idle").toLowerCase(),
    busy: Boolean(snapshot.busy),
    request_in_flight_count: Number(snapshot.request_in_flight_count ?? 0),
    line: Number(progress.line ?? 0),
    total_line: Number(progress.total_line ?? 0),
    processed_line: Number(progress.processed_line ?? 0),
    error_line: Number(progress.error_line ?? 0),
    total_tokens: Number(progress.total_tokens ?? 0),
    total_output_tokens: Number(progress.total_output_tokens ?? 0),
    total_reasoning_tokens: Number(progress.total_reasoning_tokens ?? 0),
    total_input_tokens: Number(progress.total_input_tokens ?? 0),
    time: Number(progress.time ?? 0),
    start_time: Number(progress.start_time ?? 0),
  };
}

/**
 * 只按后端运行进度判断是否存在历史展示价值，不借用项目完成度。
 */
export function has_workbench_task_progress(snapshot: WorkbenchTaskSnapshot | null): boolean {
  if (snapshot === null) {
    return false;
  }
  return (
    snapshot.line > 0 ||
    snapshot.processed_line > 0 ||
    snapshot.error_line > 0 ||
    snapshot.total_output_tokens > 0 ||
    snapshot.total_reasoning_tokens > 0 ||
    snapshot.total_input_tokens > 0 ||
    snapshot.total_tokens > 0
  );
}

/**
 * 当前运行态或已有结果优先；只有当前无展示价值时才回退到历史终态。
 */
export function resolve_workbench_task_display_snapshot<T extends WorkbenchTaskSnapshot>(args: {
  current_snapshot: T;
  last_snapshot: T | null;
  is_active: (status: string) => boolean;
  has_display_state: (snapshot: T | null) => boolean;
}): T | null {
  if (
    args.is_active(args.current_snapshot.status) ||
    args.has_display_state(args.current_snapshot)
  ) {
    return args.current_snapshot;
  }
  return args.last_snapshot !== null &&
    !args.is_active(args.last_snapshot.status) &&
    args.has_display_state(args.last_snapshot)
    ? args.last_snapshot
    : null;
}

/**
 * 指标只消费任务快照；调用方负责按任务类型判定 active。
 */
export function resolve_workbench_task_metrics(args: {
  snapshot: WorkbenchTaskSnapshot | null;
  now_seconds: number;
  active: boolean;
}): WorkbenchTaskMetrics {
  if (args.snapshot === null) {
    return {
      active: false,
      stopping: false,
      completion_percent: 0,
      processed_count: 0,
      failed_count: 0,
      elapsed_seconds: 0,
      remaining_seconds: 0,
      average_output_speed: 0,
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      request_in_flight_count: 0,
    };
  }

  const snapshot = args.snapshot;
  const elapsed_seconds =
    args.active && snapshot.start_time > 0
      ? Math.max(0, args.now_seconds - snapshot.start_time)
      : Math.max(0, snapshot.time);
  const output_tokens = Math.max(0, snapshot.total_output_tokens);
  return {
    active: args.active,
    stopping: snapshot.status === "stopping",
    completion_percent:
      snapshot.total_line <= 0
        ? 0
        : Math.min(1, Math.max(0, snapshot.line / Math.max(1, snapshot.total_line))) * 100,
    processed_count: snapshot.processed_line > 0 ? snapshot.processed_line : snapshot.line,
    failed_count: Math.max(0, snapshot.error_line),
    elapsed_seconds,
    remaining_seconds:
      snapshot.line <= 0
        ? 0
        : Math.max(
            0,
            (elapsed_seconds / Math.max(1, snapshot.line)) *
              Math.max(0, snapshot.total_line - snapshot.line),
          ),
    average_output_speed: elapsed_seconds <= 0 ? 0 : output_tokens / Math.max(1, elapsed_seconds),
    input_tokens:
      snapshot.total_input_tokens > 0
        ? snapshot.total_input_tokens
        : Math.max(
            0,
            snapshot.total_tokens - snapshot.total_reasoning_tokens - snapshot.total_output_tokens,
          ),
    reasoning_tokens: Math.max(0, snapshot.total_reasoning_tokens),
    output_tokens,
    request_in_flight_count: Math.max(0, snapshot.request_in_flight_count),
  };
}
