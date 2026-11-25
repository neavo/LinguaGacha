import { useProjectRuntimeSnapshot } from "@frontend/app/state/use-project-runtime";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import type { BatchTaskSnapshot } from "@domain/batch-task";
import { batch_task_metrics } from "@shared/batch-task";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  resolve_batch_translation_start_mode,
  is_active_batch_translation_status,
  type BatchTranslationSnapshot,
} from "@domain/batch-translation";
import type {
  ProjectWriteOperation,
  ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import {
  useDesktopState,
  useSyncBatchTranslationSnapshot,
  useBatchTranslationSnapshot,
  useBatchTaskSnapshot,
} from "@frontend/app/state/use-desktop-state";

import { useI18n } from "@frontend/app/locale/locale-context";
import type { LocaleKey } from "@shared/i18n";
import {
  type TranslationTaskConfirmState,
  type BatchTranslationPayload,
  normalize_batch_translation_snapshot,
} from "@shared/batch-translation/batch-translation";

import {
  advance_task_waveform_state,
  create_empty_task_waveform_state,
  has_unsettled_task_waveform_tail,
  TASK_WAVEFORM_SAMPLE_INTERVAL_MS,
  type BatchTranslationWaveformState,
} from "@frontend/app/session/batch-task/batch-task-waveform-state";

// 翻译任务写入的诊断名由 renderer 会话拥有，desktop 层只负责提交与互斥。
const WORKBENCH_TRANSLATION_WRITE: ProjectWriteOperation = "workbench.translation_write";

const EMPTY_TASKS: readonly BatchTaskSnapshot[] = [];
type TaskAction = ["reset-all"] | ["stop-translation", run_id: string];

type BatchTaskOptions = {
  onRequestExport: () => void; // 独立全量翻译自然完成后交给跨路由翻译成果导出流程
};

export type BatchTask = {
  task_display_snapshot: BatchTaskSnapshot | null;
  task_metrics: ReturnType<typeof batch_task_metrics>;
  active_task_count: number;
  translation_active: boolean;
  display_tasks: readonly BatchTaskSnapshot[];
  detail_task: BatchTaskSnapshot | null;
  detail_metrics: ReturnType<typeof batch_task_metrics>;
  select_task: (run_id: string) => void;
  task_waveform_history: number[];
  task_detail_sheet_open: boolean;
  task_confirm_state: TranslationTaskConfirmState | null;
  translation_action_blocked: boolean;
  open_task_detail_sheet: () => void;
  close_task_detail_sheet: () => void;
  request_start_or_continue_translation: () => Promise<void>;
  request_task_action_confirmation: (...action: TaskAction) => void;
  confirm_task_action: () => Promise<void>;
  close_task_action_confirmation: () => void;
};

/**
 * 拥有翻译任务菜单、确认框和终态反馈的 renderer 会话状态。
 */
export function useBatchTask(options: BatchTaskOptions): BatchTask {
  const api_fetch = useProjectFetch();
  const { onRequestExport } = options;
  const { t } = useI18n();

  const { active_project, project_snapshot, commit_project_write, refresh_batch_translation } =
    useDesktopState();
  const sync_task_snapshot = useSyncBatchTranslationSnapshot();
  const task_snapshot = useBatchTranslationSnapshot();
  const batch_task = useBatchTaskSnapshot();
  const runtime_snapshot = useProjectRuntimeSnapshot();
  const [now_seconds, set_now_seconds] = useState(() => Date.now() / 1000);
  const [waveforms, set_waveforms] = useState(
    () => new Map<string, BatchTranslationWaveformState>(),
  );
  const [selected_run_id, select_task] = useState<string | null>(null);
  const [task_detail_sheet_open, set_task_detail_sheet_open] = useState(false);
  const [task_confirm_state, set_task_confirm_state] = useState<TranslationTaskConfirmState | null>(
    null,
  );
  const previous_translation_status_ref = useRef<BatchTranslationSnapshot["status"]>("idle");
  const previous_active_ref = useRef(false); // 新一轮开始时从已结束批次回到活跃任务。
  const display_tasks =
    batch_task.project_path === project_snapshot.path ? batch_task.tasks : EMPTY_TASKS;
  const active_task_count = display_tasks.filter((task) =>
    is_active_batch_translation_status(task.status),
  ).length;
  // 后端列表按活跃任务优先排列，摘要始终跟随第一项。
  const task_display_snapshot = display_tasks[0] ?? null;
  const task_metrics = batch_task_metrics(task_display_snapshot, now_seconds);
  const detail_task =
    display_tasks.find((task) => task.run_id === selected_run_id) ?? task_display_snapshot;
  const detail_metrics = batch_task_metrics(detail_task, now_seconds);
  const task_waveform_history =
    detail_task === null ? [] : (waveforms.get(detail_task.run_id)?.history ?? []);

  const translation_dialog_open = task_confirm_state !== null; // 确认框打开期间延后导出提示。
  const translation_active = runtime_snapshot.owner === "batch_translation";
  const translation_action_blocked =
    !project_snapshot.loaded ||
    translation_active ||
    runtime_snapshot.owner === "project_write" ||
    translation_dialog_open;
  const has_active_task = active_task_count > 0;
  const should_animate_waveforms =
    has_active_task ||
    display_tasks.some((task) =>
      has_unsettled_task_waveform_tail(waveforms.get(task.run_id)?.history ?? []),
    );

  const append_waveform_samples = useEffectEvent((): void => {
    const now_seconds = Date.now() / 1000;
    set_now_seconds(now_seconds);
    set_waveforms((previous) => {
      const next = new Map<string, BatchTranslationWaveformState>();
      for (const task of display_tasks) {
        const state = previous.get(task.run_id);
        const active = is_active_batch_translation_status(task.status);
        if (!active && state === undefined) continue;
        // 只采样已结算的生成 Token，行进度变化不产生速度尖峰。
        const progress = task.progress;
        next.set(
          task.run_id,
          advance_task_waveform_state(state ?? create_empty_task_waveform_state(), {
            active,
            now_seconds,
            total_generated_tokens:
              (progress?.reasoning_tokens ?? 0) + (progress?.output_tokens ?? 0),
          }),
        );
      }
      return next;
    });
  });

  const open_task_detail_sheet = useCallback((): void => {
    if (project_snapshot.loaded) {
      select_task(task_display_snapshot?.run_id ?? null);
      set_task_detail_sheet_open(true);
    }
  }, [project_snapshot.loaded, task_display_snapshot?.run_id]);

  const close_task_detail_sheet = useCallback((): void => {
    set_task_detail_sheet_open(false);
  }, []);

  const request_start_or_continue_translation = useCallback(async (): Promise<void> => {
    if (translation_action_blocked) {
      return;
    }

    const should_continue =
      resolve_batch_translation_start_mode(task_snapshot.progress) === "continue";

    try {
      const task_payload = await api_fetch<BatchTranslationPayload>(
        "/api/batch-translation/start",
        {
          mode: should_continue ? "continue" : "new",
          operation: "translate",
          scope: { kind: "all" },
        },
      );
      const next_snapshot = normalize_batch_translation_snapshot(task_payload);
      sync_task_snapshot(next_snapshot);
    } catch (error) {
      push_error_toast(t("batch_translation.feedback.start_failed"), error);
    }
  }, [sync_task_snapshot, t, translation_action_blocked, task_snapshot.progress, api_fetch]);

  const request_task_action_confirmation = useCallback((...action: TaskAction): void => {
    const [kind, run_id] = action;
    set_task_confirm_state({
      kind,
      submitting: false,
      ...(kind === "stop-translation" ? { run_id } : {}),
    });
  }, []);

  const close_task_action_confirmation = useCallback((): void => {
    set_task_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null;
      }

      if (previous_state.submitting) {
        return previous_state;
      }

      return null;
    });
  }, []);

  const confirm_task_action = useCallback(async (): Promise<void> => {
    if (task_confirm_state === null) {
      return;
    }

    set_task_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null;
      }

      return {
        ...previous_state,
        submitting: true,
      };
    });

    try {
      if (task_confirm_state.kind === "stop-translation") {
        const payload = await api_fetch<Record<string, unknown>>("/api/batch-task/stop", {
          run_id: task_confirm_state.run_id,
        });
        active_project?.update_task(payload); // 与 SSE 共用本工程的任务镜像写入口。
        set_task_confirm_state(null);
      } else {
        const reset_request = { mode: "all" };
        await commit_project_write({
          operation: WORKBENCH_TRANSLATION_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>(
              "/api/workbench/translation/reset",
              reset_request,
            );
          },
        });
        push_toast("success", t("app.feedback.operation_success"));
        await refresh_batch_translation();
        set_task_confirm_state(null);
      }
    } catch (error) {
      let fallback_message = t("batch_translation.feedback.stop_failed");

      if (task_confirm_state.kind === "reset-all") {
        fallback_message = t("batch_translation.feedback.reset_all_failed");
      }

      push_error_toast(fallback_message, error);
      set_task_confirm_state((previous_state) => {
        if (previous_state === null) {
          return null;
        }

        return {
          ...previous_state,
          submitting: false,
        };
      });
    }
  }, [
    active_project,
    api_fetch,
    commit_project_write,
    refresh_batch_translation,
    t,
    task_confirm_state,
  ]);

  useEffect(() => {
    if (has_active_task && !previous_active_ref.current) select_task(null);
    previous_active_ref.current = has_active_task;
  }, [has_active_task]);

  useEffect(() => {
    set_waveforms((previous) => {
      const next = new Map(
        display_tasks.flatMap(({ run_id }) => {
          const state = previous.get(run_id);
          return state === undefined ? [] : [[run_id, state] as const];
        }),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [display_tasks]);

  useEffect(() => {
    const previous_status = previous_translation_status_ref.current;
    const next_status = task_snapshot.status;
    previous_translation_status_ref.current = next_status;

    if (!project_snapshot.loaded) {
      return;
    }

    // 提示只应该响应一次真实的生命周期跃迁，不能被首屏初始状态读取或快照重刷重复触发
    if (is_active_batch_translation_status(previous_status)) {
      const feedback = resolve_batch_translation_feedback(task_snapshot);
      if (feedback !== null) {
        push_toast(feedback.kind, t(feedback.message), {
          persistent: feedback.persistent,
          ...(feedback.exhausted_count === undefined
            ? {}
            : {
                description: t("batch_translation.feedback.retry_exhausted", {
                  count: String(feedback.exhausted_count),
                }),
              }),
        });
      }
    }

    if (!translation_dialog_open && active_project?.batch_translation.takeExportFollowup()) {
      onRequestExport();
    }
  }, [
    active_project,
    project_snapshot.loaded,
    t,
    translation_dialog_open,
    task_snapshot,
    onRequestExport,
  ]);

  useEffect(() => {
    if (!should_animate_waveforms) {
      return;
    }

    append_waveform_samples(); // 运行态和收尾态都需要继续推进采样，前者保持连贯，后者负责把尾巴渐渐扫干净
    const timer_id = window.setInterval(() => {
      append_waveform_samples();
    }, TASK_WAVEFORM_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer_id);
    };
  }, [should_animate_waveforms]);

  return {
    task_display_snapshot,
    task_metrics,
    active_task_count,
    translation_active,
    display_tasks,
    detail_task,
    detail_metrics,
    select_task,
    task_waveform_history,
    task_detail_sheet_open,
    task_confirm_state,
    translation_action_blocked,
    open_task_detail_sheet,
    close_task_detail_sheet,
    request_start_or_continue_translation,
    request_task_action_confirmation,
    confirm_task_action,
    close_task_action_confirmation,
  };
}

/** 终态反馈只消费本轮事实。Agent 子步骤由工具回执承接后续汇报。 */
function resolve_batch_translation_feedback(snapshot: BatchTranslationSnapshot): {
  kind: "success" | "warning" | "info";
  message: LocaleKey;
  persistent: boolean;
  exhausted_count?: number;
} | null {
  if (snapshot.source !== "standalone") return null;
  if (snapshot.status === "stopped") {
    return { kind: "info", message: "batch_translation.feedback.stopped", persistent: false };
  }
  if (snapshot.status !== "done") return null;
  const exhausted_count = snapshot.run_progress?.failed_line ?? 0;
  if (exhausted_count > 0) {
    return {
      kind: "warning",
      message: "batch_translation.feedback.ended",
      exhausted_count,
      persistent: true,
    };
  }
  return { kind: "success", message: "batch_translation.feedback.done", persistent: false };
}
