import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { api_fetch } from "@/app/desktop/desktop-api";
import {
  create_analysis_reset_all_plan,
  create_analysis_reset_failed_plan,
} from "@/project/reset/analysis-reset-plan";
import { type QualityRuleImportAction } from "@shared/quality/importer";
import {
  create_empty_quality_rule_import_confirm_state,
  type QualityRuleImportConfirmState,
} from "@/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-state";
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
import { read_project_section_revisions } from "@/project/query/project-section-revisions-query";
import {
  advance_workbench_waveform_state,
  create_empty_workbench_waveform_state,
  has_unsettled_workbench_waveform_tail,
  WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS,
} from "@/pages/workbench-page/task-runtime/workbench-waveform";
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
} from "@/pages/workbench-page/task-runtime/analysis-task-model";

type AnalysisTaskCommandPayload = {
  task?: Partial<AnalysisTaskSnapshot>;
};

// 分析任务 runtime 分别标记导入和重置动作，desktop 层不登记任务页面词表。
const WORKBENCH_ANALYSIS_IMPORT_MUTATION: ProjectMutationOperation = "workbench.analysis_import";
// WORKBENCH ANALYSIS RESET MUTATION 是模块级稳定契约，集中维护避免调用点散落魔术值。
const WORKBENCH_ANALYSIS_RESET_MUTATION: ProjectMutationOperation = "workbench.analysis_reset";

type AnalysisCandidatesPayload = {
  // 候选池只在导入动作前按需读取，不进入常驻项目事实。
  candidate_aggregate: Record<string, unknown>;
};

type AnalysisGlossaryImportAction = QualityRuleImportAction;

type PreparedAnalysisGlossaryImport = {
  duplicate_count: number;
  duplicate_signature: string;
  imported_count: number;
  consumed_count: number;
  quality_changed: boolean;
  updated_sections: Array<"quality" | "analysis">;
  request_body: {
    entries: Array<Record<string, unknown>>;
    consumed_candidate_srcs: string[];
    expected_section_revisions: Record<string, number>;
  };
};

type AnalysisGlossaryImportPreparePayload = {
  prepared_import: PreparedAnalysisGlossaryImport | null;
};

type AnalysisTaskRuntimeOptions = Record<string, never>;

export type AnalysisTaskRuntime = {
  analysis_task_display_snapshot: AnalysisTaskSnapshot | null;
  analysis_task_metrics: AnalysisTaskMetrics;
  analysis_waveform_history: number[];
  analysis_detail_sheet_open: boolean;
  analysis_confirm_state: AnalysisTaskConfirmState | null;
  analysis_import_confirm_state: QualityRuleImportConfirmState;
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
  import_analysis_glossary_duplicate_skip: () => Promise<void>;
  import_analysis_glossary_duplicate_overwrite: () => Promise<void>;
  close_analysis_glossary_import_confirmation: () => void;
  refresh_analysis_task_snapshot: () => Promise<void>;
};

// create_task_confirm_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_task_confirm_state(kind: AnalysisTaskActionKind): AnalysisTaskConfirmState {
  return {
    kind,
    open: true,
    submitting: false,
  };
}

// resolve_analysis_terminal_feedback_message 集中解析运行时决策，避免调用点复制条件判断。
function resolve_analysis_terminal_feedback_message(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  t: ReturnType<typeof useI18n>["t"];
}): string | null {
  if (args.previous_status === "stopping" && args.next_status !== "stopping") {
    return args.t("workbench_page.analysis_task.feedback.stopped");
  }

  if (
    !is_active_analysis_task_status(args.previous_status) ||
    args.previous_status === "stopping"
  ) {
    return null;
  }

  if (args.next_status === "done" || (args.next_status === "idle" && args.has_result)) {
    return args.t("workbench_page.analysis_task.feedback.done");
  }

  return null;
}

// should_prompt_analysis_glossary_import_confirmation 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function should_prompt_analysis_glossary_import_confirmation(args: {
  previous_status: string;
  next_status: string;
  candidate_count: number;
}): boolean {
  if (args.candidate_count <= 0) {
    return false;
  }

  if (
    args.previous_status === "stopping" ||
    !is_active_analysis_task_status(args.previous_status)
  ) {
    return false;
  }

  return args.next_status === "done" || args.next_status === "idle";
}

// is_analysis_terminal_prompt_boundary 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_analysis_terminal_prompt_boundary(args: {
  previous_status: string;
  next_status: string;
}): boolean {
  return (
    is_active_analysis_task_status(args.previous_status) &&
    !is_active_analysis_task_status(args.next_status)
  );
}

// useAnalysisTaskRuntime 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function useAnalysisTaskRuntime(
  _options: AnalysisTaskRuntimeOptions = {},
): AnalysisTaskRuntime {
  const { t } = useI18n();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const {
    project_snapshot,
    sync_task_snapshot,
    task_snapshot,
    commit_project_mutation,
    refresh_task,
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
  const [analysis_import_confirm_state, set_analysis_import_confirm_state] =
    useState<QualityRuleImportConfirmState>(() => create_empty_quality_rule_import_confirm_state());
  const [analysis_importing, set_analysis_importing] = useState(false);
  const [
    pending_analysis_import_duplicate_signature,
    set_pending_analysis_import_duplicate_signature,
  ] = useState<string | null>(null);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const previous_analysis_status_ref = useRef(create_empty_analysis_task_snapshot().status);
  const analysis_waveform_state_ref = useRef(create_empty_workbench_waveform_state());
  const {
    clear_terminal_prompt_suppression,
    consume_terminal_prompt_suppression,
    suppress_next_terminal_prompt,
  } = useTerminalPromptSuppression();
  const analysis_task_display_snapshot = useMemo(() => {
    return resolve_analysis_task_display_snapshot({
      current_snapshot: analysis_task_snapshot,
      last_snapshot: last_analysis_task_snapshot,
    });
  }, [analysis_task_snapshot, last_analysis_task_snapshot]);

  const analysis_dialog_open =
    analysis_confirm_state !== null || analysis_import_confirm_state.open;
  const analysis_action_submitting =
    analysis_importing ||
    (analysis_confirm_state !== null && analysis_confirm_state.submitting) ||
    analysis_import_confirm_state.submitting;
  const analysis_action_blocked =
    !project_snapshot.loaded || task_snapshot.busy || analysis_dialog_open || analysis_importing;
  const analysis_task_menu_busy = analysis_action_submitting;
  const analysis_task_menu_disabled = analysis_action_blocked;
  const can_open_analysis_detail_sheet =
    project_snapshot.loaded && analysis_task_display_snapshot !== null;
  const analysis_task_active = is_active_analysis_task_status(analysis_task_snapshot.status);
  const has_unsettled_analysis_waveform_tail = useMemo(() => {
    return has_unsettled_workbench_waveform_tail(analysis_waveform_history);
  }, [analysis_waveform_history]);
  const should_animate_analysis_waveform =
    analysis_task_active || has_unsettled_analysis_waveform_tail;

  const clear_analysis_waveform_sampling = useCallback((): void => {
    analysis_waveform_state_ref.current = create_empty_workbench_waveform_state();
  }, []);

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

    // 为什么：分析和翻译共用同一视觉信号模型，避免两套瞬时速度算法继续分叉。
    const next_waveform_state = advance_workbench_waveform_state(
      analysis_waveform_state_ref.current,
      {
        active: analysis_task_active,
        now_seconds: next_now_seconds,
        total_output_tokens: next_visual_snapshot.total_output_tokens,
      },
    );
    analysis_waveform_state_ref.current = next_waveform_state;
    set_analysis_waveform_history(() => {
      return next_waveform_state.history;
    });
  });

  const clear_analysis_task_state = useCallback((): void => {
    clear_terminal_prompt_suppression();
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
    set_analysis_import_confirm_state(create_empty_quality_rule_import_confirm_state());
    set_pending_analysis_import_duplicate_signature(null);
    set_analysis_importing(false);
  }, [clear_analysis_waveform_sampling, clear_terminal_prompt_suppression]);

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
        extras: { kind: "analysis", candidate_count: next_snapshot.candidate_count },
      });
    },
    [sync_task_snapshot],
  );

  const refresh_analysis_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_analysis_task_state();
      return;
    }

    if (should_defer_runtime_snapshot_refresh(task_snapshot, "analysis")) {
      return;
    }

    try {
      const task_payload = await api_fetch<AnalysisTaskPayload>("/api/tasks/snapshot", {
        task_type: "analysis",
      });
      sync_runtime_task_snapshot(normalize_analysis_task_snapshot_payload(task_payload));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(
          error,
          t,
          t("workbench_page.analysis_task.feedback.refresh_failed"),
        ),
      );
    }
  }, [
    clear_analysis_task_state,
    project_snapshot.loaded,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    task_snapshot,
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
    if (analysis_action_blocked) {
      return;
    }

    const should_continue = has_analysis_task_progress(analysis_task_display_snapshot);
    const section_revisions = await read_project_section_revisions();
    clear_terminal_prompt_suppression();

    try {
      const task_payload = await api_fetch<AnalysisTaskCommandPayload>("/api/tasks/start", {
        task_type: "analysis",
        mode: should_continue ? "continue" : "new",
        expected_section_revisions: {
          quality: section_revisions.quality ?? 0,
          prompts: section_revisions.prompts ?? 0,
        },
      });
      const next_snapshot = normalize_analysis_task_snapshot_payload(task_payload);
      sync_runtime_task_snapshot(next_snapshot);

      if (!should_continue) {
        set_last_analysis_task_snapshot(null);
        clear_analysis_waveform_sampling();
        set_analysis_waveform_history([]);
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(
          error,
          t,
          t("workbench_page.analysis_task.feedback.start_failed"),
        ),
      );
    }
  }, [
    analysis_action_blocked,
    analysis_task_display_snapshot,
    clear_terminal_prompt_suppression,
    push_toast,
    clear_analysis_waveform_sampling,
    sync_runtime_task_snapshot,
    t,
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

  const commit_prepared_analysis_glossary_import = useCallback(
    async (prepared_import: PreparedAnalysisGlossaryImport): Promise<void> => {
      await commit_project_mutation({
        operation: WORKBENCH_ANALYSIS_IMPORT_MUTATION,
        task_type: "analysis",
        run: async () => {
          return await api_fetch<ProjectMutationResultPayload>(
            "/api/project/analysis/import-glossary",
            prepared_import.request_body,
          );
        },
      });
      await refresh_task("analysis");
      push_toast(
        "success",
        t("workbench_page.analysis_task.feedback.import_success").replace(
          "{COUNT}",
          String(prepared_import.imported_count),
        ),
      );
    },
    [commit_project_mutation, push_toast, refresh_task, t],
  );

  const execute_analysis_glossary_import = useCallback(
    async (
      action: AnalysisGlossaryImportAction,
      expected_duplicate_signature: string | null = null,
    ): Promise<boolean> => {
      if (
        !project_snapshot.loaded ||
        task_snapshot.busy ||
        analysis_task_metrics.candidate_count <= 0
      ) {
        return false;
      }

      let committed = false;
      set_analysis_importing(true);

      try {
        await run_modal_progress_toast({
          message: t("workbench_page.analysis_task.feedback.import_loading_toast"),
          task: async () => {
            const candidate_payload = await api_fetch<AnalysisCandidatesPayload>(
              "/api/project/analysis/candidates",
            );
            const preview_payload = await api_fetch<AnalysisGlossaryImportPreparePayload>(
              "/api/project/query/analysis-glossary-import",
              {
                action,
                candidate_aggregate: candidate_payload.candidate_aggregate,
              },
            );
            const prepared_import = preview_payload.prepared_import;
            if (prepared_import === null) {
              set_pending_analysis_import_duplicate_signature(null);
              set_analysis_import_confirm_state(create_empty_quality_rule_import_confirm_state());
              return;
            }

            if (
              prepared_import.duplicate_count > 0 &&
              prepared_import.duplicate_signature !== expected_duplicate_signature
            ) {
              set_pending_analysis_import_duplicate_signature(prepared_import.duplicate_signature);
              set_analysis_import_confirm_state({
                open: true,
                duplicate_count: prepared_import.duplicate_count,
                submitting: false,
              });
              return;
            }

            await commit_prepared_analysis_glossary_import(prepared_import);
            set_pending_analysis_import_duplicate_signature(null);
            set_analysis_import_confirm_state(create_empty_quality_rule_import_confirm_state());
            committed = true;
          },
        });
      } finally {
        set_analysis_importing(false);
      }
      return committed;
    },
    [
      analysis_task_metrics.candidate_count,
      commit_prepared_analysis_glossary_import,
      project_snapshot.loaded,
      run_modal_progress_toast,
      task_snapshot,
      task_snapshot.busy,
      t,
    ],
  );

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
        await execute_analysis_glossary_import("overwrite");
        set_analysis_confirm_state(null);
        return;
      }

      if (analysis_confirm_state.kind === "stop-analysis") {
        const task_payload = await api_fetch<AnalysisTaskCommandPayload>("/api/tasks/stop", {
          task_type: "analysis",
        });
        const next_snapshot = normalize_analysis_task_snapshot_payload(task_payload);
        suppress_next_terminal_prompt("manual-stop");
        sync_runtime_task_snapshot(next_snapshot);
        set_analysis_confirm_state(null);
        return;
      }

      const section_revisions = await read_project_section_revisions();
      const reset_plan =
        analysis_confirm_state.kind === "reset-all"
          ? create_analysis_reset_all_plan({
              section_revisions,
              task_snapshot,
            })
          : create_analysis_reset_failed_plan({
              section_revisions,
              task_snapshot,
            });
      await commit_project_mutation({
        operation: WORKBENCH_ANALYSIS_RESET_MUTATION,
        task_type: "analysis",
        run: async () => {
          return await api_fetch<ProjectMutationResultPayload>(
            "/api/project/analysis/reset",
            reset_plan.requestBody,
          );
        },
      });
      await refresh_task("analysis");

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

      push_toast("error", resolve_visible_error_message(error, t, fallback_message));
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
    commit_project_mutation,
    execute_analysis_glossary_import,
    push_toast,
    refresh_task,
    suppress_next_terminal_prompt,
    sync_runtime_task_snapshot,
    task_snapshot,
    t,
  ]);

  const request_import_analysis_glossary = useCallback(async (): Promise<void> => {
    if (analysis_action_blocked) {
      return;
    }
    if (analysis_task_metrics.candidate_count <= 0) {
      return;
    }

    try {
      await execute_analysis_glossary_import("overwrite");
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(
          error,
          t,
          t("workbench_page.analysis_task.feedback.import_failed"),
        ),
      );
    }
  }, [
    analysis_action_blocked,
    analysis_task_metrics.candidate_count,
    execute_analysis_glossary_import,
    push_toast,
    t,
  ]);

  const close_analysis_glossary_import_confirmation = useCallback((): void => {
    if (analysis_import_confirm_state.submitting) {
      return;
    }
    set_pending_analysis_import_duplicate_signature(null);
    set_analysis_import_confirm_state(create_empty_quality_rule_import_confirm_state());
  }, [analysis_import_confirm_state.submitting]);

  const confirm_analysis_glossary_import_duplicate_action = useCallback(
    async (action: AnalysisGlossaryImportAction): Promise<void> => {
      if (pending_analysis_import_duplicate_signature === null) {
        return;
      }

      set_analysis_import_confirm_state((previous_state) => {
        return {
          ...previous_state,
          submitting: true,
        };
      });

      try {
        await execute_analysis_glossary_import(action, pending_analysis_import_duplicate_signature);
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("workbench_page.analysis_task.feedback.import_failed"),
          ),
        );
        set_analysis_import_confirm_state((previous_state) => {
          return {
            ...previous_state,
            submitting: false,
          };
        });
      }
    },
    [execute_analysis_glossary_import, pending_analysis_import_duplicate_signature, push_toast, t],
  );

  const import_analysis_glossary_duplicate_skip = useCallback(async (): Promise<void> => {
    await confirm_analysis_glossary_import_duplicate_action("skip");
  }, [confirm_analysis_glossary_import_duplicate_action]);

  const import_analysis_glossary_duplicate_overwrite = useCallback(async (): Promise<void> => {
    await confirm_analysis_glossary_import_duplicate_action("overwrite");
  }, [confirm_analysis_glossary_import_duplicate_action]);

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

    // 为什么：完成/停止提示只认真实状态跃迁，避免 hydration 和后续 refresh 把成功 toast 连续弹多次
    const feedback_message = resolve_analysis_terminal_feedback_message({
      previous_status,
      next_status,
      has_result: has_analysis_task_display_state(analysis_task_display_snapshot),
      t,
    });

    if (feedback_message !== null) {
      push_toast("success", feedback_message);
    }

    const terminal_prompt_suppressed =
      is_analysis_terminal_prompt_boundary({ previous_status, next_status }) &&
      consume_terminal_prompt_suppression();

    if (
      !analysis_dialog_open &&
      !terminal_prompt_suppressed &&
      should_prompt_analysis_glossary_import_confirmation({
        previous_status,
        next_status,
        candidate_count: analysis_task_snapshot.candidate_count,
      })
    ) {
      set_analysis_confirm_state(create_task_confirm_state("import-glossary"));
    }
  }, [
    analysis_dialog_open,
    analysis_task_snapshot.candidate_count,
    analysis_task_display_snapshot,
    analysis_task_snapshot.status,
    consume_terminal_prompt_suppression,
    project_snapshot.loaded,
    push_toast,
    t,
  ]);

  useEffect(() => {
    if (analysis_task_active) {
      return;
    }

    const next_now_seconds = Date.now() / 1000; // 为什么：结束态继续展示最终指标，波形收尾由共享状态机接管
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
  }, [analysis_task_active, analysis_task_display_snapshot]);

  useEffect(() => {
    if (!should_animate_analysis_waveform) {
      return;
    }

    append_analysis_waveform_sample(); // 为什么：运行态和衰减态都需要继续推进，前者保持上一跳，后者负责把尾巴慢慢扫成 0
    const timer_id = window.setInterval(() => {
      append_analysis_waveform_sample();
    }, WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS);

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
      analysis_import_confirm_state,
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
      import_analysis_glossary_duplicate_skip,
      import_analysis_glossary_duplicate_overwrite,
      close_analysis_glossary_import_confirmation,
      refresh_analysis_task_snapshot,
    };
  }, [
    analysis_confirm_state,
    analysis_detail_sheet_open,
    analysis_import_confirm_state,
    analysis_importing,
    analysis_task_display_snapshot,
    analysis_task_menu_busy,
    analysis_task_menu_disabled,
    analysis_task_metrics,
    analysis_waveform_history,
    close_analysis_detail_sheet,
    close_analysis_glossary_import_confirmation,
    close_analysis_task_action_confirmation,
    confirm_analysis_task_action,
    import_analysis_glossary_duplicate_overwrite,
    import_analysis_glossary_duplicate_skip,
    open_analysis_detail_sheet,
    refresh_analysis_task_snapshot,
    request_analysis_task_action_confirmation,
    request_import_analysis_glossary,
    request_start_or_continue_analysis,
  ]);
}
