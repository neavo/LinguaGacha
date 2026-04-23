const ANALYSIS_TASK_ACTIVE_STATUSES = ["REQUEST", "RUN", "ANALYZING", "STOPPING"] as const;

export type AnalysisTaskActionKind =
  | "reset-all"
  | "reset-failed"
  | "import-glossary"
  | "stop-analysis";

export type AnalysisTaskSnapshot = {
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
};

export type AnalysisTaskPayload = {
  task?: Partial<AnalysisTaskSnapshot>;
  imported_count?: number;
};

export type AnalysisTaskConfirmState = {
  kind: AnalysisTaskActionKind;
  open: boolean;
  submitting: boolean;
};

export type AnalysisTaskMetrics = {
  active: boolean;
  stopping: boolean;
  completion_percent: number;
  processed_count: number;
  failed_count: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  average_output_speed: number;
  input_tokens: number;
  output_tokens: number;
  request_in_flight_count: number;
  candidate_count: number;
};

export function create_empty_analysis_task_snapshot(): AnalysisTaskSnapshot {
  return {
    task_type: "analysis",
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
  };
}

export function clone_analysis_task_snapshot(snapshot: AnalysisTaskSnapshot): AnalysisTaskSnapshot {
  return {
    task_type: snapshot.task_type,
    status: snapshot.status,
    busy: snapshot.busy,
    request_in_flight_count: snapshot.request_in_flight_count,
    line: snapshot.line,
    total_line: snapshot.total_line,
    processed_line: snapshot.processed_line,
    error_line: snapshot.error_line,
    total_tokens: snapshot.total_tokens,
    total_output_tokens: snapshot.total_output_tokens,
    total_input_tokens: snapshot.total_input_tokens,
    time: snapshot.time,
    start_time: snapshot.start_time,
    analysis_candidate_count: snapshot.analysis_candidate_count,
  };
}

export function normalize_analysis_task_snapshot_payload(
  payload: AnalysisTaskPayload,
): AnalysisTaskSnapshot {
  const snapshot = payload.task ?? {};
  return {
    task_type: String(snapshot.task_type ?? "analysis"),
    status: String(snapshot.status ?? "IDLE"),
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
  };
}

export function is_active_analysis_task_status(status: string): boolean {
  return ANALYSIS_TASK_ACTIVE_STATUSES.includes(
    status as (typeof ANALYSIS_TASK_ACTIVE_STATUSES)[number],
  );
}

export function has_analysis_task_progress(snapshot: AnalysisTaskSnapshot | null): boolean {
  if (snapshot === null) {
    return false;
  }

  const processed_count = snapshot.processed_line > 0 ? snapshot.processed_line : snapshot.line;

  return (
    snapshot.line > 0 ||
    processed_count > 0 ||
    snapshot.error_line > 0 ||
    snapshot.total_output_tokens > 0 ||
    snapshot.total_input_tokens > 0 ||
    snapshot.total_tokens > 0
  );
}

export function has_analysis_task_display_state(snapshot: AnalysisTaskSnapshot | null): boolean {
  if (snapshot === null) {
    return false;
  }

  return has_analysis_task_progress(snapshot) || snapshot.analysis_candidate_count > 0;
}

export function resolve_analysis_task_display_snapshot(args: {
  current_snapshot: AnalysisTaskSnapshot;
  last_snapshot: AnalysisTaskSnapshot | null;
}): AnalysisTaskSnapshot | null {
  if (is_active_analysis_task_status(args.current_snapshot.status)) {
    return args.current_snapshot;
  }

  if (has_analysis_task_display_state(args.last_snapshot)) {
    return args.last_snapshot;
  }

  if (has_analysis_task_display_state(args.current_snapshot)) {
    return args.current_snapshot;
  }

  return null;
}

export function resolve_analysis_task_metrics(args: {
  snapshot: AnalysisTaskSnapshot | null;
  now_seconds: number;
}): AnalysisTaskMetrics {
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
      output_tokens: 0,
      request_in_flight_count: 0,
      candidate_count: 0,
    };
  }

  const active = is_active_analysis_task_status(args.snapshot.status);
  const stopping = args.snapshot.status === "STOPPING";
  const processed_count =
    args.snapshot.processed_line > 0 ? args.snapshot.processed_line : args.snapshot.line;
  const failed_count = Math.max(0, args.snapshot.error_line);
  const completion_ratio =
    args.snapshot.total_line <= 0
      ? 0
      : Math.min(1, Math.max(0, args.snapshot.line / Math.max(1, args.snapshot.total_line)));
  const elapsed_seconds =
    active && args.snapshot.start_time > 0
      ? Math.max(0, args.now_seconds - args.snapshot.start_time)
      : Math.max(0, args.snapshot.time);
  const remaining_seconds =
    args.snapshot.line <= 0
      ? 0
      : Math.max(
          0,
          (elapsed_seconds / Math.max(1, args.snapshot.line)) *
            Math.max(0, args.snapshot.total_line - args.snapshot.line),
        );
  const input_tokens =
    args.snapshot.total_input_tokens > 0
      ? args.snapshot.total_input_tokens
      : Math.max(0, args.snapshot.total_tokens - args.snapshot.total_output_tokens);
  const output_tokens = Math.max(0, args.snapshot.total_output_tokens);
  const average_output_speed =
    elapsed_seconds <= 0 ? 0 : output_tokens / Math.max(1, elapsed_seconds);

  return {
    active,
    stopping,
    completion_percent: completion_ratio * 100,
    processed_count,
    failed_count,
    elapsed_seconds,
    remaining_seconds,
    average_output_speed,
    input_tokens,
    output_tokens,
    request_in_flight_count: Math.max(0, args.snapshot.request_in_flight_count),
    candidate_count: Math.max(0, args.snapshot.analysis_candidate_count),
  };
}
