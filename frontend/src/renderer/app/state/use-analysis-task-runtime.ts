import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { api_fetch } from "@/app/desktop-api";
import { create_analysis_glossary_import_plan } from "@/app/project-runtime/analysis-glossary-import";
import { createProjectStoreReplaceSectionPatch } from "@/app/project-runtime/project-store";
import { serializeQualityRuntimeSnapshot } from "@/app/project-runtime/quality-runtime";
import {
  normalize_project_mutation_ack,
  type ProjectMutationAckPayload,
} from "@/app/state/desktop-runtime-context";
import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from "@/app/state/project-pages-barrier";
import { WORKBENCH_PROGRESS_UI_REFRESH_INTERVAL_MS } from "@/app/state/workbench-progress-constants";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";
import { useDesktopToast } from "@/app/state/use-desktop-toast";
import { useI18n } from "@/i18n";
import {
  append_workbench_waveform_sample,
  decay_workbench_waveform_sample,
  has_unsettled_workbench_waveform_tail,
} from "@/lib/workbench-waveform";
import {
  clone_analysis_task_snapshot,
  create_empty_analysis_task_snapshot,
  has_analysis_task_display_state,
  has_analysis_task_progress,
  is_active_analysis_task_status,
  normalize_analysis_task_snapshot_payload,
  resolve_analysis_task_display_snapshot,
  resolve_analysis_task_metrics,
  type AnalysisTaskActionKind,
  type AnalysisTaskConfirmState,
  type AnalysisTaskMetrics,
  type AnalysisTaskPayload,
  type AnalysisTaskSnapshot,
} from "@/lib/analysis-task";

type AnalysisTaskCommandPayload = {
  task?: Partial<AnalysisTaskSnapshot>;
  imported_count?: number;
};

type AnalysisTaskRuntimeOptions = {
  createProjectPagesBarrierCheckpoint?: () => ProjectPagesBarrierCheckpoint;
  waitForProjectPagesBarrier?: (
    kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
    options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
  ) => Promise<void>;
};

export type AnalysisTaskRuntime = {
  analysis_task_display_snapshot: AnalysisTaskSnapshot | null;
  analysis_task_metrics: AnalysisTaskMetrics;
  analysis_waveform_history: number[];
  analysis_detail_sheet_open: boolean;
  analysis_confirm_state: AnalysisTaskConfirmState | null;
  analysis_importing: boolean;
  analysis_task_menu_disabled: boolean;
  analysis_task_menu_busy: boolean;
  open_analysis_detail_sheet: () => void;
  close_analysis_detail_sheet: () => void;
  request_start_or_continue_analysis: () => Promise<void>;
  request_analysis_task_action_confirmation: (kind: AnalysisTaskActionKind) => void;
  confirm_analysis_task_action: () => Promise<void>;
  close_analysis_task_action_confirmation: () => void;
  request_import_analysis_glossary: () => Promise<void>;
  refresh_analysis_task_snapshot: () => Promise<void>;
};

function resolve_error_message(error: unknown, fallback_message: string): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback_message;
}

function create_task_confirm_state(kind: AnalysisTaskActionKind): AnalysisTaskConfirmState {
  return {
    kind,
    open: true,
    submitting: false,
  };
}

function has_analysis_waveform_progress_changed(
  previous_snapshot: AnalysisTaskSnapshot,
  next_snapshot: AnalysisTaskSnapshot,
): boolean {
  if (previous_snapshot.total_output_tokens !== next_snapshot.total_output_tokens) {
    return true;
  }
  if (previous_snapshot.line !== next_snapshot.line) {
    return true;
  }
  if (previous_snapshot.processed_line !== next_snapshot.processed_line) {
    return true;
  }
  if (previous_snapshot.error_line !== next_snapshot.error_line) {
    return true;
  }

  return false;
}

function resolve_analysis_waveform_sample(args: {
  previous_snapshot: AnalysisTaskSnapshot | null;
  previous_time: number | null;
  next_snapshot: AnalysisTaskSnapshot;
  next_metrics: AnalysisTaskMetrics;
  next_now_seconds: number;
}): number {
  if (args.previous_snapshot === null || args.previous_time === null) {
    return args.next_metrics.average_output_speed;
  }

  if (!has_analysis_waveform_progress_changed(args.previous_snapshot, args.next_snapshot)) {
    return 0;
  }

  const elapsed_seconds = Math.max(0.001, args.next_now_seconds - args.previous_time);
  const output_token_delta = Math.max(
    0,
    args.next_snapshot.total_output_tokens - args.previous_snapshot.total_output_tokens,
  );

  return output_token_delta / elapsed_seconds;
}

function resolve_analysis_terminal_feedback_message(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  t: ReturnType<typeof useI18n>["t"];
}): string | null {
  if (args.previous_status === "STOPPING" && args.next_status !== "STOPPING") {
    return args.t("workbench_page.analysis_task.feedback.stopped");
  }

  if (
    !is_active_analysis_task_status(args.previous_status) ||
    args.previous_status === "STOPPING"
  ) {
    return null;
  }

  if (args.next_status === "DONE" || (args.next_status === "IDLE" && args.has_result)) {
    return args.t("workbench_page.analysis_task.feedback.done");
  }

  return null;
}

function should_prompt_analysis_glossary_import_confirmation(args: {
  previous_status: string;
  next_status: string;
  candidate_count: number;
}): boolean {
  if (args.candidate_count <= 0) {
    return false;
  }

  if (
    args.previous_status === "STOPPING" ||
    !is_active_analysis_task_status(args.previous_status)
  ) {
    return false;
  }

  return args.next_status === "DONE" || args.next_status === "IDLE";
}

export function useAnalysisTaskRuntime(
  options: AnalysisTaskRuntimeOptions = {},
): AnalysisTaskRuntime {
  const { t } = useI18n();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const {
    project_store,
    project_snapshot,
    workbench_change_signal,
    set_task_snapshot,
    task_snapshot,
    commit_local_project_patch,
    refresh_project_runtime,
    align_project_runtime_ack,
  } = useDesktopRuntime();
  const [analysis_task_snapshot, set_analysis_task_snapshot] = useState<AnalysisTaskSnapshot>(
    () => {
      return create_empty_analysis_task_snapshot();
    },
  );
  const [last_analysis_task_snapshot, set_last_analysis_task_snapshot] =
    useState<AnalysisTaskSnapshot | null>(null);
  const [analysis_task_metrics, set_analysis_task_metrics] = useState<AnalysisTaskMetrics>(() => {
    return resolve_analysis_task_metrics({
      snapshot: null,
      now_seconds: 0,
    });
  });
  const [analysis_waveform_history, set_analysis_waveform_history] = useState<number[]>([]);
  const [analysis_detail_sheet_open, set_analysis_detail_sheet_open] = useState(false);
  const [analysis_confirm_state, set_analysis_confirm_state] =
    useState<AnalysisTaskConfirmState | null>(null);
  const [analysis_importing, set_analysis_importing] = useState(false);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const previous_task_busy_ref = useRef(task_snapshot.busy);
  const previous_workbench_change_seq_ref = useRef(workbench_change_signal.seq);
  const previous_analysis_status_ref = useRef(create_empty_analysis_task_snapshot().status);
  const observed_analysis_waveform_snapshot_ref = useRef<AnalysisTaskSnapshot | null>(null);
  const observed_analysis_waveform_time_ref = useRef<number | null>(null);
  const current_analysis_waveform_sample_ref = useRef(0);

  const analysis_task_display_snapshot = useMemo(() => {
    return resolve_analysis_task_display_snapshot({
      current_snapshot: analysis_task_snapshot,
      last_snapshot: last_analysis_task_snapshot,
    });
  }, [analysis_task_snapshot, last_analysis_task_snapshot]);

  const analysis_task_menu_busy =
    analysis_importing || (analysis_confirm_state !== null && analysis_confirm_state.submitting);
  const analysis_task_menu_disabled =
    !project_snapshot.loaded || task_snapshot.busy || analysis_task_menu_busy;
  const can_open_analysis_detail_sheet =
    project_snapshot.loaded && analysis_task_display_snapshot !== null;
  const analysis_task_active = is_active_analysis_task_status(analysis_task_snapshot.status);
  const has_unsettled_analysis_waveform_tail = useMemo(() => {
    return has_unsettled_workbench_waveform_tail(analysis_waveform_history);
  }, [analysis_waveform_history]);
  const should_animate_analysis_waveform =
    analysis_task_active || has_unsettled_analysis_waveform_tail;

  const reset_analysis_waveform_observation = useCallback((): void => {
    observed_analysis_waveform_snapshot_ref.current = null;
    observed_analysis_waveform_time_ref.current = null;
  }, []);

  const clear_analysis_waveform_sampling = useCallback((): void => {
    reset_analysis_waveform_observation();
    current_analysis_waveform_sample_ref.current = 0;
  }, [reset_analysis_waveform_observation]);

  const append_analysis_waveform_sample = useEffectEvent((): void => {
    const next_now_seconds = Date.now() / 1000;
    const next_visual_snapshot =
      analysis_task_display_snapshot === null
        ? null
        : clone_analysis_task_snapshot(analysis_task_display_snapshot);
    const next_metrics = resolve_analysis_task_metrics({
      snapshot: next_visual_snapshot,
      now_seconds: next_now_seconds,
    });
    set_analysis_task_metrics(next_metrics);

    if (next_visual_snapshot === null) {
      return;
    }

    const previous_observed_snapshot = observed_analysis_waveform_snapshot_ref.current;
    const previous_observed_time = observed_analysis_waveform_time_ref.current;
    if (analysis_task_active) {
      const has_progress_delta =
        previous_observed_snapshot !== null &&
        previous_observed_time !== null &&
        has_analysis_waveform_progress_changed(previous_observed_snapshot, next_visual_snapshot);

      if (previous_observed_snapshot === null || previous_observed_time === null) {
        current_analysis_waveform_sample_ref.current = next_metrics.average_output_speed;
        observed_analysis_waveform_snapshot_ref.current = next_visual_snapshot;
        observed_analysis_waveform_time_ref.current = next_now_seconds;
      } else if (has_progress_delta) {
        current_analysis_waveform_sample_ref.current = resolve_analysis_waveform_sample({
          previous_snapshot: previous_observed_snapshot,
          previous_time: previous_observed_time,
          next_snapshot: next_visual_snapshot,
          next_metrics,
          next_now_seconds,
        });
        observed_analysis_waveform_snapshot_ref.current = next_visual_snapshot;
        observed_analysis_waveform_time_ref.current = next_now_seconds;
      }

      // 为什么：运行态两帧之间没有新数据时，分析波形也要延续上一跳，才能维持连贯的监视器节奏。
      set_analysis_waveform_history((previous_history) => {
        return append_workbench_waveform_sample(
          previous_history,
          current_analysis_waveform_sample_ref.current,
        );
      });
      return;
    }

    current_analysis_waveform_sample_ref.current = decay_workbench_waveform_sample(
      current_analysis_waveform_sample_ref.current,
    );

    // 为什么：分析任务结束后只保留衰减中的尾巴继续前推，直到可见窗口完全沉到 0。
    set_analysis_waveform_history((previous_history) => {
      return append_workbench_waveform_sample(
        previous_history,
        current_analysis_waveform_sample_ref.current,
      );
    });
  });

  const clear_analysis_task_state = useCallback((): void => {
    set_analysis_task_snapshot(create_empty_analysis_task_snapshot());
    set_last_analysis_task_snapshot(null);
    set_analysis_task_metrics(
      resolve_analysis_task_metrics({
        snapshot: null,
        now_seconds: 0,
      }),
    );
    clear_analysis_waveform_sampling();
    set_analysis_waveform_history([]);
    set_analysis_detail_sheet_open(false);
    set_analysis_confirm_state(null);
    set_analysis_importing(false);
  }, [clear_analysis_waveform_sampling]);

  const apply_analysis_task_snapshot = useCallback(
    (next_snapshot: AnalysisTaskSnapshot): void => {
      const normalized_snapshot = clone_analysis_task_snapshot(next_snapshot);
      set_analysis_task_snapshot(normalized_snapshot);

      if (is_active_analysis_task_status(normalized_snapshot.status)) {
        return;
      }

      if (has_analysis_task_display_state(normalized_snapshot)) {
        set_last_analysis_task_snapshot(clone_analysis_task_snapshot(normalized_snapshot));
        return;
      }

      set_last_analysis_task_snapshot(null);
      clear_analysis_waveform_sampling();
      set_analysis_waveform_history([]);
      set_analysis_detail_sheet_open(false);
    },
    [clear_analysis_waveform_sampling],
  );

  const sync_runtime_task_snapshot = useCallback(
    (next_snapshot: AnalysisTaskSnapshot): void => {
      set_task_snapshot({
        task_type: next_snapshot.task_type,
        status: next_snapshot.status,
        busy: next_snapshot.busy,
        request_in_flight_count: next_snapshot.request_in_flight_count,
        line: next_snapshot.line,
        total_line: next_snapshot.total_line,
        processed_line: next_snapshot.processed_line,
        error_line: next_snapshot.error_line,
        total_tokens: next_snapshot.total_tokens,
        total_output_tokens: next_snapshot.total_output_tokens,
        total_input_tokens: next_snapshot.total_input_tokens,
        time: next_snapshot.time,
        start_time: next_snapshot.start_time,
        analysis_candidate_count: next_snapshot.analysis_candidate_count,
      });
    },
    [set_task_snapshot],
  );

  const refresh_analysis_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_analysis_task_state();
      return;
    }

    try {
      const task_payload = await api_fetch<AnalysisTaskPayload>("/api/v2/tasks/snapshot", {
        task_type: "analysis",
      });
      apply_analysis_task_snapshot(normalize_analysis_task_snapshot_payload(task_payload));
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("workbench_page.analysis_task.feedback.refresh_failed")),
      );
    }
  }, [
    apply_analysis_task_snapshot,
    clear_analysis_task_state,
    project_snapshot.loaded,
    push_toast,
    t,
  ]);

  const open_analysis_detail_sheet = useCallback((): void => {
    if (can_open_analysis_detail_sheet) {
      set_analysis_detail_sheet_open(true);
    }
  }, [can_open_analysis_detail_sheet]);

  const close_analysis_detail_sheet = useCallback((): void => {
    set_analysis_detail_sheet_open(false);
  }, []);

  const request_start_or_continue_analysis = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || task_snapshot.busy || analysis_task_menu_busy) {
      return;
    }

    const should_continue = has_analysis_task_progress(analysis_task_display_snapshot);

    try {
      const task_payload = await api_fetch<AnalysisTaskCommandPayload>(
        "/api/v2/tasks/start-analysis",
        {
          mode: should_continue ? "CONTINUE" : "NEW",
          quality_snapshot: serializeQualityRuntimeSnapshot(project_store.getState()),
        },
      );
      const next_snapshot = normalize_analysis_task_snapshot_payload(task_payload);
      apply_analysis_task_snapshot(next_snapshot);
      sync_runtime_task_snapshot(next_snapshot);

      if (!should_continue) {
        set_last_analysis_task_snapshot(null);
        clear_analysis_waveform_sampling();
        set_analysis_waveform_history([]);
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("workbench_page.analysis_task.feedback.start_failed")),
      );
    }
  }, [
    analysis_task_display_snapshot,
    analysis_task_menu_busy,
    apply_analysis_task_snapshot,
    project_store,
    project_snapshot.loaded,
    push_toast,
    clear_analysis_waveform_sampling,
    sync_runtime_task_snapshot,
    t,
    task_snapshot.busy,
  ]);

  const request_analysis_task_action_confirmation = useCallback(
    (kind: AnalysisTaskActionKind): void => {
      set_analysis_confirm_state(create_task_confirm_state(kind));
    },
    [],
  );

  const close_analysis_task_action_confirmation = useCallback((): void => {
    set_analysis_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null;
      }

      if (previous_state.submitting) {
        return previous_state;
      }

      return null;
    });
  }, []);

  const execute_analysis_glossary_import = useCallback(async (): Promise<void> => {
    if (
      !project_snapshot.loaded ||
      task_snapshot.busy ||
      analysis_task_metrics.candidate_count <= 0
    ) {
      return;
    }

    const barrierCheckpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null;
    set_analysis_importing(true);

    try {
      await run_modal_progress_toast({
        message: t("workbench_page.analysis_task.feedback.import_loading_toast"),
        task: async () => {
          const import_plan = await create_analysis_glossary_import_plan(project_store.getState());
          if (import_plan === null) {
            return;
          }

          const local_commit = commit_local_project_patch({
            source: "analysis_import_glossary",
            updatedSections: ["quality", "analysis", "task"],
            patch: [
              createProjectStoreReplaceSectionPatch("quality", import_plan.next_quality_state),
              createProjectStoreReplaceSectionPatch("analysis", import_plan.next_analysis_state),
              createProjectStoreReplaceSectionPatch("task", import_plan.next_task_snapshot),
            ],
          });

          try {
            apply_analysis_task_snapshot(
              normalize_analysis_task_snapshot_payload({
                task: import_plan.next_task_snapshot,
              }),
            );
            const mutation_ack = normalize_project_mutation_ack(
              await api_fetch<ProjectMutationAckPayload>(
                "/api/v2/project/analysis/import-glossary",
                import_plan.request_body,
              ),
            );
            align_project_runtime_ack(mutation_ack);
          } catch (error) {
            local_commit.rollback();
            void refresh_project_runtime().catch(() => {});
            throw error;
          }

          if (options.waitForProjectPagesBarrier !== undefined) {
            await options.waitForProjectPagesBarrier("proofreading_cache_refresh", {
              checkpoint: barrierCheckpoint,
            });
          }
          push_toast(
            "success",
            t("workbench_page.analysis_task.feedback.import_success").replace(
              "{COUNT}",
              String(import_plan.imported_count),
            ),
          );
        },
      });
    } finally {
      set_analysis_importing(false);
    }
  }, [
    align_project_runtime_ack,
    analysis_task_metrics.candidate_count,
    apply_analysis_task_snapshot,
    commit_local_project_patch,
    options,
    project_snapshot.loaded,
    project_store,
    push_toast,
    refresh_project_runtime,
    run_modal_progress_toast,
    task_snapshot.busy,
    t,
  ]);

  const confirm_analysis_task_action = useCallback(async (): Promise<void> => {
    if (analysis_confirm_state === null) {
      return;
    }

    set_analysis_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null;
      }

      return {
        ...previous_state,
        submitting: true,
      };
    });

    try {
      if (analysis_confirm_state.kind === "import-glossary") {
        await execute_analysis_glossary_import();
        set_analysis_confirm_state(null);
        return;
      }

      let path = "/api/v2/tasks/stop-analysis";
      if (analysis_confirm_state.kind === "reset-all") {
        path = "/api/v2/tasks/reset-analysis-all";
      } else if (analysis_confirm_state.kind === "reset-failed") {
        path = "/api/v2/tasks/reset-analysis-failed";
      }

      const task_payload = await api_fetch<AnalysisTaskCommandPayload>(path, {});
      const next_snapshot = normalize_analysis_task_snapshot_payload(task_payload);
      apply_analysis_task_snapshot(next_snapshot);
      sync_runtime_task_snapshot(next_snapshot);
      // 为什么：分析 reset 不直接改工作台快照；这里若等待 workbench barrier，确认弹窗会卡在一个不会推进的 loading 态。
      set_analysis_confirm_state(null);
    } catch (error) {
      let fallback_message = t("workbench_page.analysis_task.feedback.stop_failed");
      if (analysis_confirm_state.kind === "reset-all") {
        fallback_message = t("workbench_page.analysis_task.feedback.reset_all_failed");
      } else if (analysis_confirm_state.kind === "reset-failed") {
        fallback_message = t("workbench_page.analysis_task.feedback.reset_failed_failed");
      } else if (analysis_confirm_state.kind === "import-glossary") {
        fallback_message = t("workbench_page.analysis_task.feedback.import_failed");
      }

      push_toast("error", resolve_error_message(error, fallback_message));
      set_analysis_confirm_state((previous_state) => {
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
    analysis_confirm_state,
    apply_analysis_task_snapshot,
    execute_analysis_glossary_import,
    push_toast,
    sync_runtime_task_snapshot,
    t,
  ]);

  const request_import_analysis_glossary = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || task_snapshot.busy || analysis_task_menu_busy) {
      return;
    }
    if (analysis_task_metrics.candidate_count <= 0) {
      return;
    }

    try {
      await execute_analysis_glossary_import();
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("workbench_page.analysis_task.feedback.import_failed")),
      );
    }
  }, [
    analysis_task_menu_busy,
    analysis_task_metrics.candidate_count,
    execute_analysis_glossary_import,
    project_snapshot.loaded,
    push_toast,
    t,
    task_snapshot.busy,
  ]);

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      clear_analysis_task_state();
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_analysis_task_state();
      void refresh_analysis_task_snapshot();
    }
  }, [
    clear_analysis_task_state,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_analysis_task_snapshot,
  ]);

  useEffect(() => {
    const previous_task_busy = previous_task_busy_ref.current;
    previous_task_busy_ref.current = task_snapshot.busy;

    if (!project_snapshot.loaded) {
      return;
    }

    if (previous_task_busy && !task_snapshot.busy) {
      void refresh_analysis_task_snapshot();
    }
  }, [project_snapshot.loaded, refresh_analysis_task_snapshot, task_snapshot.busy]);

  useEffect(() => {
    const previous_seq = previous_workbench_change_seq_ref.current;
    previous_workbench_change_seq_ref.current = workbench_change_signal.seq;

    if (!project_snapshot.loaded) {
      return;
    }

    if (previous_seq !== workbench_change_signal.seq) {
      void refresh_analysis_task_snapshot();
    }
  }, [project_snapshot.loaded, workbench_change_signal.seq, refresh_analysis_task_snapshot]);

  useEffect(() => {
    if (task_snapshot.task_type !== "analysis") {
      return;
    }

    apply_analysis_task_snapshot(
      normalize_analysis_task_snapshot_payload({
        task: task_snapshot,
      }),
    );
  }, [apply_analysis_task_snapshot, task_snapshot]);

  useEffect(() => {
    const previous_status = previous_analysis_status_ref.current;
    const next_status = analysis_task_snapshot.status;
    previous_analysis_status_ref.current = next_status;

    if (!project_snapshot.loaded) {
      return;
    }

    // 为什么：完成/停止提示只认真实状态跃迁，避免 hydration 和后续 refresh 把成功 toast 连续弹多次。
    const feedback_message = resolve_analysis_terminal_feedback_message({
      previous_status,
      next_status,
      has_result: has_analysis_task_display_state(analysis_task_display_snapshot),
      t,
    });

    if (feedback_message !== null) {
      push_toast("success", feedback_message);
    }

    if (
      analysis_confirm_state === null &&
      should_prompt_analysis_glossary_import_confirmation({
        previous_status,
        next_status,
        candidate_count: analysis_task_snapshot.analysis_candidate_count,
      })
    ) {
      set_analysis_confirm_state(create_task_confirm_state("import-glossary"));
    }
  }, [
    analysis_confirm_state,
    analysis_task_snapshot.analysis_candidate_count,
    analysis_task_display_snapshot,
    analysis_task_snapshot.status,
    project_snapshot.loaded,
    push_toast,
    t,
  ]);

  useEffect(() => {
    if (analysis_task_active) {
      return;
    }

    // 为什么：结束态继续展示最终指标，但采样只保留最后一跳，后续由衰减尾巴负责收束到 0。
    const next_now_seconds = Date.now() / 1000;
    const next_visual_snapshot =
      analysis_task_display_snapshot === null
        ? null
        : clone_analysis_task_snapshot(analysis_task_display_snapshot);
    set_analysis_task_metrics(
      resolve_analysis_task_metrics({
        snapshot: next_visual_snapshot,
        now_seconds: next_now_seconds,
      }),
    );
    reset_analysis_waveform_observation();
  }, [reset_analysis_waveform_observation, analysis_task_active, analysis_task_display_snapshot]);

  useEffect(() => {
    if (!should_animate_analysis_waveform) {
      return;
    }

    // 为什么：运行态和衰减态都需要继续推进，前者保持上一跳，后者负责把尾巴慢慢扫成 0。
    append_analysis_waveform_sample();
    const timer_id = window.setInterval(() => {
      append_analysis_waveform_sample();
    }, WORKBENCH_PROGRESS_UI_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer_id);
    };
  }, [should_animate_analysis_waveform]);

  useEffect(() => {
    if (!can_open_analysis_detail_sheet) {
      set_analysis_detail_sheet_open(false);
    }
  }, [can_open_analysis_detail_sheet]);

  return useMemo<AnalysisTaskRuntime>(() => {
    return {
      analysis_task_display_snapshot,
      analysis_task_metrics,
      analysis_waveform_history,
      analysis_detail_sheet_open,
      analysis_confirm_state,
      analysis_importing,
      analysis_task_menu_disabled,
      analysis_task_menu_busy,
      open_analysis_detail_sheet,
      close_analysis_detail_sheet,
      request_start_or_continue_analysis,
      request_analysis_task_action_confirmation,
      confirm_analysis_task_action,
      close_analysis_task_action_confirmation,
      request_import_analysis_glossary,
      refresh_analysis_task_snapshot,
    };
  }, [
    analysis_confirm_state,
    analysis_detail_sheet_open,
    analysis_importing,
    analysis_task_display_snapshot,
    analysis_task_menu_busy,
    analysis_task_menu_disabled,
    analysis_task_metrics,
    analysis_waveform_history,
    close_analysis_detail_sheet,
    close_analysis_task_action_confirmation,
    confirm_analysis_task_action,
    open_analysis_detail_sheet,
    refresh_analysis_task_snapshot,
    request_analysis_task_action_confirmation,
    request_import_analysis_glossary,
    request_start_or_continue_analysis,
  ]);
}
