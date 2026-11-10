import type { BatchTaskSnapshot } from "@domain/batch-task";
import { batch_task_metrics, read_batch_task_snapshot } from "@shared/batch-task";
import {
  useBatchTaskSnapshot,
  useSyncBatchTaskSnapshot,
} from "@frontend/app/state/use-desktop-state";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
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
  useRuntimeSnapshot,
  useSyncBatchTranslationSnapshot,
  useBatchTranslationSnapshot,
} from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";

import { useI18n } from "@frontend/app/locale/locale-context";
import type { LocaleKey } from "@shared/i18n";
import {
  should_open_translation_generation_followup,
  create_empty_batch_translation_snapshot,
  type TranslationTaskActionKind,
  type TranslationTaskConfirmState,
  type BatchTranslationPayload,
  normalize_batch_translation_snapshot,
} from "@shared/batch-translation/batch-translation";

import {
  advance_task_waveform_state,
  create_empty_task_waveform_state,
  has_unsettled_task_waveform_tail,
  TASK_WAVEFORM_SAMPLE_INTERVAL_MS,
} from "@frontend/app/session/batch-task/batch-task-waveform-state";

// 翻译任务写入的诊断名由 renderer 会话拥有，desktop 层只负责提交与互斥。
const WORKBENCH_TRANSLATION_WRITE: ProjectWriteOperation = "workbench.translation_write";

type BatchTaskOptions = {
  onRequestGeneration: () => void; // 独立全量翻译自然完成后交给跨路由译文生成流程
};

export type BatchTask = {
  task_display_snapshot: BatchTaskSnapshot | null;
  task_metrics: ReturnType<typeof batch_task_metrics>;
  task_waveform_history: number[];
  task_detail_sheet_open: boolean;
  task_confirm_state: TranslationTaskConfirmState | null;
  translation_task_menu_disabled: boolean;
  translation_task_menu_busy: boolean;
  open_task_detail_sheet: () => void;
  close_task_detail_sheet: () => void;
  request_start_or_continue_translation: () => Promise<void>;
  request_task_action_confirmation: (kind: TranslationTaskActionKind) => void;
  confirm_task_action: () => Promise<void>;
  close_task_action_confirmation: () => void;
};

/**
 * 拥有翻译任务菜单、确认框和终态反馈的 renderer 会话状态。
 */
export function useBatchTask(options: BatchTaskOptions): BatchTask {
  const { onRequestGeneration } = options;
  const { t } = useI18n();

  const { project_snapshot, commit_project_write, refresh_batch_translation } = useDesktopState();
  const sync_task_snapshot = useSyncBatchTranslationSnapshot();
  const task_snapshot = useBatchTranslationSnapshot();
  const batch_task = useBatchTaskSnapshot();
  const sync_batch_task = useSyncBatchTaskSnapshot();
  const runtime_snapshot = useRuntimeSnapshot();
  const [now_seconds, set_now_seconds] = useState(() => Date.now() / 1000);
  const [task_waveform_history, set_task_waveform_history] = useState<number[]>([]);
  const [task_detail_sheet_open, set_task_detail_sheet_open] = useState(false);
  const [task_confirm_state, set_task_confirm_state] = useState<TranslationTaskConfirmState | null>(
    null,
  );
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const previous_translation_status_ref = useRef(create_empty_batch_translation_snapshot().status);
  const translation_waveform_state_ref = useRef(create_empty_task_waveform_state());
  const task_display_snapshot =
    batch_task.status === "idle" || batch_task.project_path !== project_snapshot.path
      ? null
      : batch_task;
  const task_metrics = batch_task_metrics(task_display_snapshot, now_seconds);

  const translation_dialog_open = task_confirm_state !== null;
  const translation_action_blocked =
    !project_snapshot.loaded || is_runtime_busy(runtime_snapshot) || translation_dialog_open;
  const translation_task_menu_busy = task_confirm_state?.submitting ?? false;
  const translation_task_menu_disabled = translation_action_blocked;
  const can_open_task_detail_sheet = project_snapshot.loaded;
  const translation_task_active = is_active_batch_translation_status(batch_task.status);
  const has_unsettled_translation_waveform_tail =
    has_unsettled_task_waveform_tail(task_waveform_history);
  const should_animate_translation_waveform =
    translation_task_active || has_unsettled_translation_waveform_tail;

  const clear_translation_waveform_sampling = useCallback((): void => {
    translation_waveform_state_ref.current = create_empty_task_waveform_state();
  }, []);

  const append_translation_waveform_sample = useEffectEvent((): void => {
    const next_now_seconds = Date.now() / 1000;
    const next_visual_snapshot = task_display_snapshot;
    const next_metrics = batch_task_metrics(next_visual_snapshot, next_now_seconds);
    set_now_seconds(next_now_seconds);

    if (next_visual_snapshot === null) {
      return;
    }

    // 波形只消费已归一的累计生成 token，行进度变化不应制造 0 样本或尖峰。
    const next_waveform_state = advance_task_waveform_state(
      translation_waveform_state_ref.current,
      {
        active: translation_task_active,
        now_seconds: next_now_seconds,
        total_generated_tokens: next_metrics.reasoning_tokens + next_metrics.output_tokens,
      },
    );
    translation_waveform_state_ref.current = next_waveform_state;
    set_task_waveform_history(() => {
      return next_waveform_state.history;
    });
  });

  const clear_translation_task_state = useCallback((): void => {
    clear_translation_waveform_sampling();
    set_task_waveform_history([]);
    set_task_detail_sheet_open(false);
    set_task_confirm_state(null);
  }, [clear_translation_waveform_sampling]);

  const refresh_translation_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_translation_task_state();
      return;
    }

    try {
      const task_payload = await api_fetch<BatchTranslationPayload>("/api/batch-task/snapshot", {});
      sync_batch_task(read_batch_task_snapshot(task_payload));
      sync_task_snapshot(normalize_batch_translation_snapshot(task_payload));
    } catch (error) {
      push_error_toast(t("batch_translation.feedback.refresh_failed"), error);
    }
  }, [
    clear_translation_task_state,
    project_snapshot.loaded,
    sync_task_snapshot,
    sync_batch_task,
    t,
  ]);

  const open_task_detail_sheet = useCallback((): void => {
    if (can_open_task_detail_sheet) {
      set_task_detail_sheet_open(true);
    }
  }, [can_open_task_detail_sheet]);

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

      if (!should_continue) {
        clear_translation_waveform_sampling();
        set_task_waveform_history([]);
      }
    } catch (error) {
      push_error_toast(t("batch_translation.feedback.start_failed"), error);
    }
  }, [
    sync_task_snapshot,
    t,
    translation_action_blocked,
    task_snapshot.progress,
    clear_translation_waveform_sampling,
  ]);

  const request_task_action_confirmation = useCallback(
    (kind: TranslationTaskActionKind): void => {
      set_task_confirm_state({
        kind,
        submitting: false,
        ...(kind === "stop-translation" ? { run_id: batch_task.run_id ?? "" } : {}),
      });
    },
    [batch_task.run_id],
  );

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
        const task_payload = await api_fetch<BatchTranslationPayload>("/api/batch-task/stop", {
          run_id: task_confirm_state.run_id,
        });
        const next_snapshot = normalize_batch_translation_snapshot(task_payload);
        sync_task_snapshot(next_snapshot);
        sync_batch_task(read_batch_task_snapshot(task_payload));
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
    commit_project_write,
    refresh_batch_translation,
    sync_task_snapshot,
    sync_batch_task,
    t,
    task_confirm_state,
  ]);

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      clear_translation_task_state();
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_translation_task_state();
      void refresh_translation_task_snapshot();
    }
  }, [
    clear_translation_task_state,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_translation_task_snapshot,
  ]);

  useEffect(() => {
    clear_translation_waveform_sampling();
    set_task_waveform_history([]);
  }, [batch_task.run_id, clear_translation_waveform_sampling]);

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

    if (
      !translation_dialog_open &&
      should_open_translation_generation_followup(previous_status, task_snapshot)
    ) {
      onRequestGeneration();
    }
  }, [project_snapshot.loaded, t, translation_dialog_open, task_snapshot, onRequestGeneration]);

  useEffect(() => {
    if (!should_animate_translation_waveform) {
      return;
    }

    append_translation_waveform_sample(); // 运行态和收尾态都需要继续推进采样，前者保持连贯，后者负责把尾巴渐渐扫干净
    const timer_id = window.setInterval(() => {
      append_translation_waveform_sample();
    }, TASK_WAVEFORM_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer_id);
    };
  }, [should_animate_translation_waveform]);

  return {
    task_display_snapshot,
    task_metrics,
    task_waveform_history,
    task_detail_sheet_open,
    task_confirm_state,
    translation_task_menu_disabled,
    translation_task_menu_busy,
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
