import {
  clone_translation_scope,
  is_active_translation_task_status,
  normalize_translation_scope,
  type TranslationScope,
} from "../../domain/task";
import {
  create_empty_workbench_task_snapshot,
  has_workbench_task_progress,
  normalize_workbench_task_snapshot_payload,
  resolve_workbench_task_display_snapshot,
  resolve_workbench_task_metrics,
  type WorkbenchTaskMetrics,
  type WorkbenchTaskSnapshot,
  type WorkbenchTaskSnapshotPayload,
} from "./task-model";

export { is_active_translation_task_status };

export type TranslationTaskActionKind = "reset-all" | "reset-failed" | "stop-translation";

export type TranslationTaskSnapshot = WorkbenchTaskSnapshot & {
  scope: TranslationScope;
};

export type TranslationTaskPayload = {
  task?: WorkbenchTaskSnapshotPayload & {
    scope?: TranslationScope;
    extras?: {
      kind?: string;
      scope?: unknown;
    };
  };
};

export type TranslationTaskConfirmState = {
  kind: TranslationTaskActionKind;
  open: boolean;
  submitting: boolean;
};

export type TranslationTaskMetrics = WorkbenchTaskMetrics;

// 翻译任务默认覆盖全部条目，局部重翻必须由 extras 显式声明。
export function create_empty_translation_task_snapshot(): TranslationTaskSnapshot {
  return {
    ...create_empty_workbench_task_snapshot("translation"),
    scope: { kind: "all" },
  };
}

// scope 可能携带可变 item_ids，克隆时必须与原快照分离。
export function clone_translation_task_snapshot(
  snapshot: TranslationTaskSnapshot,
): TranslationTaskSnapshot {
  return {
    ...snapshot,
    scope: clone_translation_scope(snapshot.scope),
  };
}

// 翻译 scope 优先读取后端 extras，并在边界统一归一 item_ids。
export function normalize_translation_task_snapshot_payload(
  payload: TranslationTaskPayload,
): TranslationTaskSnapshot {
  const snapshot = payload.task ?? {};
  return {
    ...normalize_workbench_task_snapshot_payload(snapshot, "translation"),
    scope: normalize_translation_scope(snapshot.extras?.scope ?? snapshot.scope),
  };
}

// 已知任务总量也构成展示状态，即使尚未处理第一行。
export function has_translation_task_progress(snapshot: TranslationTaskSnapshot | null): boolean {
  return snapshot !== null && (snapshot.total_line > 0 || has_workbench_task_progress(snapshot));
}

// 翻译任务按共享规则选择当前或历史终态。
export function resolve_translation_task_display_snapshot(args: {
  current_snapshot: TranslationTaskSnapshot;
  last_snapshot: TranslationTaskSnapshot | null;
}): TranslationTaskSnapshot | null {
  return resolve_workbench_task_display_snapshot({
    ...args,
    is_active: is_active_translation_task_status,
    has_display_state: has_translation_task_progress,
  });
}

// 翻译指标完全复用工作台公共口径。
export function resolve_translation_task_metrics(args: {
  snapshot: TranslationTaskSnapshot | null;
  now_seconds: number;
}): TranslationTaskMetrics {
  return resolve_workbench_task_metrics({
    ...args,
    active: args.snapshot !== null && is_active_translation_task_status(args.snapshot.status),
  });
}
