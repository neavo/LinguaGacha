import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { api_fetch } from "@/app/desktop/desktop-api";
import {
  create_translation_reset_all_plan,
  create_translation_reset_failed_plan,
} from "@/project/reset/translation-reset-plan";
import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from "@/app/page-runtime/project-pages-barrier";
import {
  type ProjectMutationOperation,
  type ProjectMutationResultPayload,
} from "@/app/desktop/desktop-project-mutation";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
import { useDesktopToast } from "@/app/ui-runtime/toast/use-desktop-toast";
import { resolve_visible_error_message } from "@/app/ui-runtime/error-message";
import { useI18n } from "@/app/locale/locale-provider";
import { should_defer_runtime_snapshot_refresh } from "@/pages/workbench-page/task-runtime/task-runtime-ownership";
import { useTerminalPromptSuppression } from "@/pages/workbench-page/task-runtime/terminal-prompt-suppression";
import {
  advance_workbench_waveform_state,
  create_empty_workbench_waveform_state,
  has_unsettled_workbench_waveform_tail,
  WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS,
} from "@/pages/workbench-page/task-runtime/workbench-waveform";
import {
  clone_translation_task_snapshot,
  create_empty_translation_task_snapshot,
  has_translation_task_progress,
  is_active_translation_task_status,
  normalize_translation_task_snapshot_payload,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
  type TranslationTaskActionKind,
  type TranslationTaskConfirmState,
  type TranslationTaskMetrics,
  type TranslationTaskPayload,
  type TranslationTaskSnapshot,
} from "@/pages/workbench-page/task-runtime/translation-task-model";

type TranslationTaskCommandPayload = {
  task?: Partial<TranslationTaskSnapshot>;
};

// 翻译任务 runtime 拥有翻译提交 operation，任务归因通过 task_type 固定到 translation。
const WORKBENCH_TRANSLATION_MUTATION: ProjectMutationOperation = "workbench.translation_mutation";

type TranslationTaskRuntimeOptions = {
  createProjectPagesBarrierCheckpoint?: () => ProjectPagesBarrierCheckpoint;
  waitForProjectPagesBarrier?: (
    kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
    options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
  ) => Promise<void>;
};

export type TranslationTaskRuntime = {
  translation_task_display_snapshot: TranslationTaskSnapshot | null;
  translation_task_metrics: TranslationTaskMetrics;
  translation_waveform_history: number[];
  translation_detail_sheet_open: boolean;
  task_confirm_state: TranslationTaskConfirmState | null;
  translation_task_menu_disabled: boolean;
  translation_task_menu_busy: boolean;
  open_translation_detail_sheet: () => void;
  close_translation_detail_sheet: () => void;
  request_start_or_continue_translation: () => Promise<void>;
  request_task_action_confirmation: (kind: TranslationTaskActionKind) => void;
  confirm_task_action: () => Promise<void>;
  close_task_action_confirmation: () => void;
};

// create_task_confirm_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_task_confirm_state(kind: TranslationTaskActionKind): TranslationTaskConfirmState {
  return {
    kind,
    open: true,
    submitting: false,
  };
}

// resolve_translation_terminal_feedback_message 集中解析运行时决策，避免调用点复制条件判断。
function resolve_translation_terminal_feedback_message(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  t: ReturnType<typeof useI18n>["t"];
}): string | null {
  if (args.previous_status === "stopping" && args.next_status !== "stopping") {
    return args.t("workbench_page.translation_task.feedback.stopped");
  }

  if (
    !is_active_translation_task_status(args.previous_status) ||
    args.previous_status === "stopping"
  ) {
    return null;
  }

  if (args.next_status === "done" || (args.next_status === "idle" && args.has_result)) {
    return args.t("workbench_page.translation_task.feedback.done");
  }

  return null;
}

// should_prompt_translation_generate_confirmation 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function should_prompt_translation_generate_confirmation(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
}): boolean {
  if (
    args.previous_status === "stopping" ||
    !is_active_translation_task_status(args.previous_status)
  ) {
    return false;
  }

  if (args.next_status === "done") {
    return true;
  }

  return args.next_status === "idle" && args.has_result;
}

// is_translation_terminal_prompt_boundary 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_translation_terminal_prompt_boundary(args: {
  previous_status: string;
  next_status: string;
}): boolean {
  return (
    is_active_translation_task_status(args.previous_status) &&
    !is_active_translation_task_status(args.next_status)
  );
}

// useTranslationTaskRuntime 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function useTranslationTaskRuntime(
  options: TranslationTaskRuntimeOptions = {},
): TranslationTaskRuntime {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const {
    project_store,
    project_snapshot,
    settings_snapshot,
    sync_task_snapshot,
    task_snapshot,
    commit_project_mutation,
    refresh_task,
  } = useDesktopRuntime();
  const [translation_task_snapshot, set_translation_task_snapshot] =
    useState<TranslationTaskSnapshot>(() => {
      return create_empty_translation_task_snapshot();
    });
  const [last_translation_task_snapshot, set_last_translation_task_snapshot] =
    useState<TranslationTaskSnapshot | null>(null);
  const [translation_task_metrics, set_translation_task_metrics] = useState<TranslationTaskMetrics>(
    () => {
      return resolve_translation_task_metrics({
        snapshot: null,
        now_seconds: 0,
      });
    },
  );
  const [translation_waveform_history, set_translation_waveform_history] = useState<number[]>([]);
  const [translation_detail_sheet_open, set_translation_detail_sheet_open] = useState(false);
  const [task_confirm_state, set_task_confirm_state] = useState<TranslationTaskConfirmState | null>(
    null,
  );
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const previous_translation_status_ref = useRef(create_empty_translation_task_snapshot().status);
  const translation_waveform_state_ref = useRef(create_empty_workbench_waveform_state());
  const {
    clear_terminal_prompt_suppression,
    consume_terminal_prompt_suppression,
    suppress_next_terminal_prompt,
  } = useTerminalPromptSuppression();
  const translation_task_display_snapshot = useMemo(() => {
    return resolve_translation_task_display_snapshot({
      current_snapshot: translation_task_snapshot,
      last_snapshot: last_translation_task_snapshot,
    });
  }, [last_translation_task_snapshot, translation_task_snapshot]);

  const translation_dialog_open = task_confirm_state !== null;
  const translation_action_submitting =
    task_confirm_state !== null && task_confirm_state.submitting;
  const translation_action_blocked =
    !project_snapshot.loaded || task_snapshot.busy || translation_dialog_open;
  const translation_task_menu_busy = translation_action_submitting;
  const translation_task_menu_disabled = translation_action_blocked;
  const can_open_translation_detail_sheet = project_snapshot.loaded;
  const translation_task_active = is_active_translation_task_status(
    translation_task_snapshot.status,
  );
  const has_unsettled_translation_waveform_tail = useMemo(() => {
    return has_unsettled_workbench_waveform_tail(translation_waveform_history);
  }, [translation_waveform_history]);
  const should_animate_translation_waveform =
    translation_task_active || has_unsettled_translation_waveform_tail;

  const clear_translation_waveform_sampling = useCallback((): void => {
    translation_waveform_state_ref.current = create_empty_workbench_waveform_state();
  }, []);

  const append_translation_waveform_sample = useEffectEvent((): void => {
    const next_now_seconds = Date.now() / 1000;
    const next_visual_snapshot =
      translation_task_display_snapshot === null
        ? null
        : clone_translation_task_snapshot(translation_task_display_snapshot);
    const next_metrics = resolve_translation_task_metrics({
      snapshot: next_visual_snapshot,
      now_seconds: next_now_seconds,
    });
    set_translation_task_metrics(next_metrics);

    if (next_visual_snapshot === null) {
      return;
    }

    // 为什么：波形只消费累计输出 token，行进度变化不应制造 0 样本或尖峰。
    const next_waveform_state = advance_workbench_waveform_state(
      translation_waveform_state_ref.current,
      {
        active: translation_task_active,
        now_seconds: next_now_seconds,
        total_output_tokens: next_visual_snapshot.total_output_tokens,
      },
    );
    translation_waveform_state_ref.current = next_waveform_state;
    set_translation_waveform_history(() => {
      return next_waveform_state.history;
    });
  });

  const clear_translation_task_state = useCallback((): void => {
    clear_terminal_prompt_suppression();
    set_translation_task_snapshot(create_empty_translation_task_snapshot());
    set_last_translation_task_snapshot(null);
    set_translation_task_metrics(
      resolve_translation_task_metrics({
        snapshot: null,
        now_seconds: 0,
      }),
    );
    clear_translation_waveform_sampling();
    set_translation_waveform_history([]);
    set_translation_detail_sheet_open(false);
    set_task_confirm_state(null);
  }, [clear_terminal_prompt_suppression, clear_translation_waveform_sampling]);

  const apply_translation_task_snapshot = useCallback(
    (next_snapshot: TranslationTaskSnapshot): void => {
      const normalized_snapshot = clone_translation_task_snapshot(next_snapshot);
      set_translation_task_snapshot(normalized_snapshot);

      if (is_active_translation_task_status(normalized_snapshot.status)) {
        return;
      }

      if (has_translation_task_progress(normalized_snapshot)) {
        set_last_translation_task_snapshot(clone_translation_task_snapshot(normalized_snapshot));
      } else {
        set_last_translation_task_snapshot(null);
        clear_translation_waveform_sampling();
        set_translation_waveform_history([]);
        set_translation_detail_sheet_open(false);
      }
    },
    [clear_translation_waveform_sampling],
  );

  const sync_runtime_task_snapshot = useCallback(
    (next_snapshot: TranslationTaskSnapshot): void => {
      sync_task_snapshot({
        runtime_revision: next_snapshot.runtime_revision,
        task_type: next_snapshot.task_type,
        status: next_snapshot.status,
        busy: next_snapshot.busy,
        request_in_flight_count: next_snapshot.request_in_flight_count,
        progress: {
          line: next_snapshot.line,
          total_line: next_snapshot.total_line,
          processed_line: next_snapshot.processed_line,
          error_line: next_snapshot.error_line,
          total_tokens: next_snapshot.total_tokens,
          total_output_tokens: next_snapshot.total_output_tokens,
          total_input_tokens: next_snapshot.total_input_tokens,
          time: next_snapshot.time,
          start_time: next_snapshot.start_time,
        },
        extras: { kind: "translation", scope: { kind: "all" } },
      });
    },
    [sync_task_snapshot],
  );

  const refresh_translation_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_translation_task_state();
      return;
    }

    if (should_defer_runtime_snapshot_refresh(task_snapshot, "translation")) {
      return;
    }

    try {
      const task_payload = await api_fetch<TranslationTaskPayload>("/api/tasks/snapshot", {
        task_type: "translation",
      });
      sync_runtime_task_snapshot(normalize_translation_task_snapshot_payload(task_payload));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(
          error,
          t,
          t("workbench_page.translation_task.feedback.refresh_failed"),
        ),
      );
    }
  }, [
    clear_translation_task_state,
    project_snapshot.loaded,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    task_snapshot,
  ]);

  const open_translation_detail_sheet = useCallback((): void => {
    if (can_open_translation_detail_sheet) {
      set_translation_detail_sheet_open(true);
    }
  }, [can_open_translation_detail_sheet]);

  const close_translation_detail_sheet = useCallback((): void => {
    set_translation_detail_sheet_open(false);
  }, []);

  const request_start_or_continue_translation = useCallback(async (): Promise<void> => {
    if (translation_action_blocked) {
      return;
    }

    const should_continue = has_translation_task_progress(translation_task_display_snapshot);
    const current_project_state = project_store.getState();
    clear_terminal_prompt_suppression();

    try {
      const task_payload = await api_fetch<TranslationTaskCommandPayload>("/api/tasks/start", {
        task_type: "translation",
        mode: should_continue ? "continue" : "new",
        scope: { kind: "all" },
        expected_section_revisions: {
          quality: current_project_state.revisions.sections.quality ?? 0,
          prompts: current_project_state.revisions.sections.prompts ?? 0,
        },
      });
      const next_snapshot = normalize_translation_task_snapshot_payload(task_payload);
      sync_runtime_task_snapshot(next_snapshot);

      if (!should_continue) {
        set_last_translation_task_snapshot(null);
        clear_translation_waveform_sampling();
        set_translation_waveform_history([]);
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(
          error,
          t,
          t("workbench_page.translation_task.feedback.start_failed"),
        ),
      );
    }
  }, [
    clear_terminal_prompt_suppression,
    project_store,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    translation_action_blocked,
    translation_task_display_snapshot,
    clear_translation_waveform_sampling,
  ]);

  const request_task_action_confirmation = useCallback((kind: TranslationTaskActionKind): void => {
    set_task_confirm_state(create_task_confirm_state(kind));
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

    const barrierCheckpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null;

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
        const task_payload = await api_fetch<TranslationTaskCommandPayload>("/api/tasks/stop", {
          task_type: "translation",
        });
        const next_snapshot = normalize_translation_task_snapshot_payload(task_payload);
        suppress_next_terminal_prompt("manual-stop");
        sync_runtime_task_snapshot(next_snapshot);
        set_task_confirm_state(null);
      } else if (task_confirm_state.kind === "generate-translation") {
        await api_fetch("/api/tasks/generate-translation", {});
        set_task_confirm_state(null);
      } else {
        const reset_plan =
          task_confirm_state.kind === "reset-all"
            ? create_translation_reset_all_plan({
                state: project_store.getState(),
                task_snapshot,
                source_language: String(settings_snapshot.source_language ?? "ALL"),
                mtool_optimizer_enable: Boolean(settings_snapshot.mtool_optimizer_enable),
                skip_duplicate_source_text_enable: Boolean(
                  settings_snapshot.skip_duplicate_source_text_enable,
                ),
              })
            : create_translation_reset_failed_plan({
                state: project_store.getState(),
                task_snapshot,
              });
        await commit_project_mutation({
          operation: WORKBENCH_TRANSLATION_MUTATION,
          task_type: "translation",
          run: async () => {
            return await api_fetch<ProjectMutationResultPayload>(
              "/api/project/translation/reset",
              reset_plan.requestBody,
            );
          },
        });
        await refresh_task("translation");

        if (options.waitForProjectPagesBarrier !== undefined) {
          await options.waitForProjectPagesBarrier("proofreading_cache_refresh", {
            checkpoint: barrierCheckpoint,
          });
        }
        set_task_confirm_state(null);
      }
    } catch (error) {
      let fallback_message = t("workbench_page.translation_task.feedback.stop_failed");

      if (task_confirm_state.kind === "reset-all") {
        fallback_message = t("workbench_page.translation_task.feedback.reset_all_failed");
      } else if (task_confirm_state.kind === "reset-failed") {
        fallback_message = t("workbench_page.translation_task.feedback.reset_failed_failed");
      } else if (task_confirm_state.kind === "generate-translation") {
        fallback_message = t("workbench_page.translation_task.feedback.generate_failed");
      }

      push_toast("error", resolve_visible_error_message(error, t, fallback_message));
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
    commit_project_mutation,
    options,
    project_store,
    refresh_task,
    push_toast,
    settings_snapshot.mtool_optimizer_enable,
    settings_snapshot.source_language,
    suppress_next_terminal_prompt,
    sync_runtime_task_snapshot,
    t,
    task_confirm_state,
    task_snapshot,
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
    if (task_snapshot.task_type !== "translation") {
      return;
    }

    apply_translation_task_snapshot(
      normalize_translation_task_snapshot_payload({
        task: task_snapshot,
      }),
    );
  }, [apply_translation_task_snapshot, task_snapshot]);

  useEffect(() => {
    const previous_status = previous_translation_status_ref.current;
    const next_status = translation_task_snapshot.status;
    previous_translation_status_ref.current = next_status;

    if (!project_snapshot.loaded) {
      return;
    }

    // 为什么：toast 只应该响应一次真实的生命周期跃迁，不能被首屏 hydration 或快照重刷重复触发
    const feedback_message = resolve_translation_terminal_feedback_message({
      previous_status,
      next_status,
      has_result: has_translation_task_progress(translation_task_display_snapshot),
      t,
    });

    if (feedback_message !== null) {
      push_toast("success", feedback_message);
    }

    const terminal_prompt_suppressed =
      is_translation_terminal_prompt_boundary({ previous_status, next_status }) &&
      consume_terminal_prompt_suppression();

    if (
      !translation_dialog_open &&
      !terminal_prompt_suppressed &&
      should_prompt_translation_generate_confirmation({
        previous_status,
        next_status,
        has_result: has_translation_task_progress(translation_task_display_snapshot),
      })
    ) {
      set_task_confirm_state(create_task_confirm_state("generate-translation"));
    }
  }, [
    project_snapshot.loaded,
    consume_terminal_prompt_suppression,
    push_toast,
    t,
    translation_dialog_open,
    translation_task_display_snapshot,
    translation_task_snapshot.status,
  ]);

  useEffect(() => {
    if (translation_task_active) {
      return;
    }

    const next_now_seconds = Date.now() / 1000; // 为什么：结束态仍然要对齐最终指标，波形尾巴由共享状态机继续衰减
    const next_visual_snapshot =
      translation_task_display_snapshot === null
        ? null
        : clone_translation_task_snapshot(translation_task_display_snapshot);
    set_translation_task_metrics(
      resolve_translation_task_metrics({
        snapshot: next_visual_snapshot,
        now_seconds: next_now_seconds,
      }),
    );
  }, [translation_task_active, translation_task_display_snapshot]);

  useEffect(() => {
    if (!should_animate_translation_waveform) {
      return;
    }

    append_translation_waveform_sample(); // 为什么：运行态和收尾态都需要继续推进采样，前者保持连贯，后者负责把尾巴渐渐扫干净
    const timer_id = window.setInterval(() => {
      append_translation_waveform_sample();
    }, WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer_id);
    };
  }, [should_animate_translation_waveform]);

  useEffect(() => {
    if (!can_open_translation_detail_sheet) {
      set_translation_detail_sheet_open(false);
    }
  }, [can_open_translation_detail_sheet]);

  return useMemo<TranslationTaskRuntime>(() => {
    return {
      translation_task_display_snapshot,
      translation_task_metrics,
      translation_waveform_history,
      translation_detail_sheet_open,
      task_confirm_state,
      translation_task_menu_disabled,
      translation_task_menu_busy,
      open_translation_detail_sheet,
      close_translation_detail_sheet,
      request_start_or_continue_translation,
      request_task_action_confirmation,
      confirm_task_action,
      close_task_action_confirmation,
    };
  }, [
    close_task_action_confirmation,
    close_translation_detail_sheet,
    confirm_task_action,
    open_translation_detail_sheet,
    request_start_or_continue_translation,
    request_task_action_confirmation,
    task_confirm_state,
    translation_detail_sheet_open,
    translation_task_display_snapshot,
    translation_task_menu_busy,
    translation_task_menu_disabled,
    translation_task_metrics,
    translation_waveform_history,
  ]);
}
