import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  clone_translation_scope,
  resolve_batch_translation_start_mode,
  is_active_batch_translation_status,
  type BatchTranslationScope,
  type BatchTranslationSnapshot,
} from "@domain/batch-translation";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import {
  useDesktopState,
  useRuntimeSnapshot,
  useSyncBatchTranslationSnapshot,
  useBatchTranslationSnapshot,
} from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { resolve_batch_translation_generated_tokens } from "@shared/batch-translation/batch-translation";

import {
  advance_task_waveform_state,
  create_empty_task_waveform_state,
  has_unsettled_task_waveform_tail,
  TASK_WAVEFORM_SAMPLE_INTERVAL_MS,
} from "@frontend/app/session/batch-translation/batch-translation-waveform-state";
import {
  clone_translation_task_snapshot,
  should_open_translation_export_followup,
  create_empty_batch_translation_snapshot,
  has_translation_task_progress,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
  type TranslationTaskActionKind,
  type TranslationTaskConfirmState,
  type BatchTranslationMetrics,
  type BatchTranslationPayload,
} from "@shared/batch-translation/batch-translation";
import { normalize_batch_translation_snapshot } from "@shared/batch-translation/batch-translation";

// 翻译任务写入的诊断名由 renderer 会话拥有，desktop 层只负责提交与互斥。
const WORKBENCH_TRANSLATION_WRITE: ProjectWriteOperation = "workbench.translation_write";

type BatchTranslationTaskOptions = {
  onRequestExport: () => void; // 全量翻译自然完成后交给跨路由导出流程
};

export type BatchTranslationTask = {
  translation_task_display_snapshot: BatchTranslationSnapshot | null;
  translation_task_metrics: BatchTranslationMetrics;
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

/** 定点任务收尾会清空 scope，导出判断保留本轮已观察到的定点范围。 */
function resolve_active_translation_completion_scope(args: {
  active_scope: BatchTranslationScope | null;
  next_scope: BatchTranslationScope;
}): BatchTranslationScope {
  if (args.next_scope.kind === "items") {
    return clone_translation_scope(args.next_scope);
  }

  if (args.active_scope?.kind === "items") {
    return clone_translation_scope(args.active_scope);
  }

  return { kind: "all" };
}

/**
 * 拥有翻译任务菜单、确认框、终态提示和完成范围的 renderer 会话状态。
 */
export function useBatchTranslationTask(
  options: BatchTranslationTaskOptions,
): BatchTranslationTask {
  const { onRequestExport } = options;
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { project_snapshot, settings_snapshot, commit_project_write, refresh_batch_translation } =
    useDesktopState();
  const sync_task_snapshot = useSyncBatchTranslationSnapshot();
  const task_snapshot = useBatchTranslationSnapshot();
  const runtime_snapshot = useRuntimeSnapshot();
  const translation_task_snapshot = task_snapshot;
  const [last_translation_task_snapshot, set_last_translation_task_snapshot] =
    useState<BatchTranslationSnapshot | null>(null);
  const [now_seconds, set_now_seconds] = useState(() => Date.now() / 1000);
  const [translation_waveform_history, set_translation_waveform_history] = useState<number[]>([]);
  const [translation_detail_sheet_open, set_translation_detail_sheet_open] = useState(false);
  const [task_confirm_state, set_task_confirm_state] = useState<TranslationTaskConfirmState | null>(
    null,
  );
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const previous_translation_status_ref = useRef(create_empty_batch_translation_snapshot().status);
  const translation_completion_scope_ref = useRef<BatchTranslationScope>(
    create_empty_batch_translation_snapshot().scope,
  );
  const active_translation_completion_scope_ref = useRef<BatchTranslationScope | null>(null);
  const translation_waveform_state_ref = useRef(create_empty_task_waveform_state());
  const translation_task_display_snapshot = useMemo(() => {
    return resolve_translation_task_display_snapshot({
      current_snapshot: translation_task_snapshot,
      last_snapshot: last_translation_task_snapshot,
    });
  }, [last_translation_task_snapshot, translation_task_snapshot]);

  const translation_task_metrics = resolve_translation_task_metrics({
    snapshot: translation_task_display_snapshot,
    now_seconds,
  });

  const translation_dialog_open = task_confirm_state !== null;
  const translation_action_submitting =
    task_confirm_state !== null && task_confirm_state.submitting;
  const translation_action_blocked =
    !project_snapshot.loaded || is_runtime_busy(runtime_snapshot) || translation_dialog_open;
  const translation_task_menu_busy = translation_action_submitting;
  const translation_task_menu_disabled = translation_action_blocked;
  const can_open_translation_detail_sheet = project_snapshot.loaded;
  const translation_task_active = is_active_batch_translation_status(
    translation_task_snapshot.status,
  );
  const has_unsettled_translation_waveform_tail = useMemo(() => {
    return has_unsettled_task_waveform_tail(translation_waveform_history);
  }, [translation_waveform_history]);
  const should_animate_translation_waveform =
    translation_task_active || has_unsettled_translation_waveform_tail;

  const clear_translation_waveform_sampling = useCallback((): void => {
    translation_waveform_state_ref.current = create_empty_task_waveform_state();
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
    set_now_seconds(next_now_seconds);

    if (next_visual_snapshot === null) {
      return;
    }

    // 为什么：波形只消费已归一的累计生成 token，行进度变化不应制造 0 样本或尖峰。
    const next_waveform_state = advance_task_waveform_state(
      translation_waveform_state_ref.current,
      {
        active: translation_task_active,
        now_seconds: next_now_seconds,
        total_generated_tokens: resolve_batch_translation_generated_tokens(next_metrics),
      },
    );
    translation_waveform_state_ref.current = next_waveform_state;
    set_translation_waveform_history(() => {
      return next_waveform_state.history;
    });
  });

  const clear_translation_task_state = useCallback((): void => {
    translation_completion_scope_ref.current = { kind: "all" };
    active_translation_completion_scope_ref.current = null;

    set_last_translation_task_snapshot(null);

    clear_translation_waveform_sampling();
    set_translation_waveform_history([]);
    set_translation_detail_sheet_open(false);
    set_task_confirm_state(null);
  }, [clear_translation_waveform_sampling]);

  const apply_translation_task_snapshot = useCallback(
    (next_snapshot: BatchTranslationSnapshot): void => {
      const normalized_snapshot = clone_translation_task_snapshot(next_snapshot);

      const next_scope = clone_translation_scope(normalized_snapshot.scope);

      if (is_active_batch_translation_status(normalized_snapshot.status)) {
        const completion_scope = resolve_active_translation_completion_scope({
          active_scope: active_translation_completion_scope_ref.current,
          next_scope,
        });
        active_translation_completion_scope_ref.current = clone_translation_scope(completion_scope);
        translation_completion_scope_ref.current = clone_translation_scope(completion_scope);
      } else {
        active_translation_completion_scope_ref.current = null;
        if (next_scope.kind === "items") {
          translation_completion_scope_ref.current = clone_translation_scope(next_scope);
        }
      }

      if (is_active_batch_translation_status(normalized_snapshot.status)) {
        return;
      }

      if (has_translation_task_progress(normalized_snapshot)) {
        set_last_translation_task_snapshot(clone_translation_task_snapshot(normalized_snapshot));
      } else {
        set_last_translation_task_snapshot(null);
        clear_translation_waveform_sampling();
        set_translation_waveform_history([]);
      }
    },
    [clear_translation_waveform_sampling],
  );

  const sync_runtime_task_snapshot = sync_task_snapshot;

  const refresh_translation_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_translation_task_state();
      return;
    }

    try {
      const task_payload = await api_fetch<BatchTranslationPayload>(
        "/api/batch-translation/snapshot",
        {},
      );
      sync_runtime_task_snapshot(normalize_batch_translation_snapshot(task_payload));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("batch_translation.feedback.refresh_failed")),
      );
    }
  }, [
    clear_translation_task_state,
    project_snapshot.loaded,
    push_toast,
    sync_runtime_task_snapshot,
    t,
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

    const should_continue =
      resolve_batch_translation_start_mode(task_snapshot.progress) === "continue";

    try {
      const task_payload = await api_fetch<BatchTranslationPayload>(
        "/api/batch-translation/start",
        {
          mode: should_continue ? "continue" : "new",
          scope: { kind: "all" },
        },
      );
      const next_snapshot = normalize_batch_translation_snapshot(task_payload);
      sync_runtime_task_snapshot(next_snapshot);

      if (!should_continue) {
        set_last_translation_task_snapshot(null);
        clear_translation_waveform_sampling();
        set_translation_waveform_history([]);
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("batch_translation.feedback.start_failed")),
      );
    }
  }, [
    push_toast,
    sync_runtime_task_snapshot,
    t,
    translation_action_blocked,
    task_snapshot.progress,
    clear_translation_waveform_sampling,
  ]);

  const request_task_action_confirmation = useCallback((kind: TranslationTaskActionKind): void => {
    set_task_confirm_state({ kind, submitting: false });
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
        const task_payload = await api_fetch<BatchTranslationPayload>(
          "/api/batch-translation/stop",
          {},
        );
        const next_snapshot = normalize_batch_translation_snapshot(task_payload);
        sync_runtime_task_snapshot(next_snapshot);
        set_task_confirm_state(null);
      } else {
        const reset_request =
          task_confirm_state.kind === "reset-all"
            ? {
                mode: "all",
                project_settings: {
                  source_language: String(settings_snapshot.source_language ?? "ALL"),
                  mtool_optimizer_enable: Boolean(settings_snapshot.mtool_optimizer_enable),
                  skip_duplicate_source_text_enable: Boolean(
                    settings_snapshot.skip_duplicate_source_text_enable,
                  ),
                },
              }
            : { mode: "failed" };
        await commit_project_write({
          operation: WORKBENCH_TRANSLATION_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>(
              "/api/workbench/translation/reset",
              reset_request,
            );
          },
        });
        await refresh_batch_translation();
        set_task_confirm_state(null);
      }
    } catch (error) {
      let fallback_message = t("batch_translation.feedback.stop_failed");

      if (task_confirm_state.kind === "reset-all") {
        fallback_message = t("batch_translation.feedback.reset_all_failed");
      } else if (task_confirm_state.kind === "reset-failed") {
        fallback_message = t("batch_translation.feedback.reset_failed_failed");
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
    commit_project_write,
    refresh_batch_translation,
    push_toast,
    settings_snapshot.mtool_optimizer_enable,
    settings_snapshot.source_language,
    settings_snapshot.skip_duplicate_source_text_enable,
    sync_runtime_task_snapshot,
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
    apply_translation_task_snapshot(task_snapshot);
  }, [apply_translation_task_snapshot, task_snapshot]);

  useEffect(() => {
    const previous_status = previous_translation_status_ref.current;
    const next_status = translation_task_snapshot.status;
    previous_translation_status_ref.current = next_status;

    if (!project_snapshot.loaded) {
      return;
    }

    // 为什么：提示只应该响应一次真实的生命周期跃迁，不能被首屏初始状态读取或快照重刷重复触发
    if (is_active_batch_translation_status(previous_status)) {
      if (next_status === "done" || next_status === "stopped") {
        push_toast("success", t(`batch_translation.feedback.${next_status}`));
      }
    }

    if (
      !translation_dialog_open &&
      should_open_translation_export_followup({
        previous_status,
        next_status,
        scope: translation_completion_scope_ref.current,
      })
    ) {
      onRequestExport();
    }
  }, [
    project_snapshot.loaded,
    push_toast,
    t,
    translation_dialog_open,
    translation_task_snapshot.status,
    onRequestExport,
  ]);

  useEffect(() => {
    if (!should_animate_translation_waveform) {
      return;
    }

    append_translation_waveform_sample(); // 为什么：运行态和收尾态都需要继续推进采样，前者保持连贯，后者负责把尾巴渐渐扫干净
    const timer_id = window.setInterval(() => {
      append_translation_waveform_sample();
    }, TASK_WAVEFORM_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer_id);
    };
  }, [should_animate_translation_waveform]);

  return useMemo<BatchTranslationTask>(() => {
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
