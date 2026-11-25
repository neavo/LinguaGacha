import { useEffect, useEffectEvent, useState } from "react";
import { generated_batch_task_tokens, type BatchTranslationCompletion } from "@domain/batch-task";
import { batch_task_metrics } from "@shared/batch-task";
import type { TextResolver } from "@shared/i18n";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useProjectRuntimeSnapshot } from "@frontend/app/state/use-project-runtime";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { useBatchTaskSnapshot, useDesktopState } from "@frontend/app/state/use-desktop-state";
import type {
  ProjectWriteOperation,
  ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { build_batch_task_summary_display } from "@frontend/features/batch-task/batch-task-display";
import {
  sample_batch_task_speed,
  TASK_WAVEFORM_SAMPLE_INTERVAL_MS,
  type BatchTaskSpeed,
} from "./batch-task-waveform-state";

const WORKBENCH_TRANSLATION_WRITE: ProjectWriteOperation = "workbench.translation_write";
const EMPTY_HISTORY: readonly number[] = [];

type TaskAction = "reset-all" | "stop";
type TaskConfirmation = { submitting: boolean } & (
  | { kind: "reset-all" }
  | { kind: "stop"; run_ids: readonly string[] }
);

/** 同一工程的入口和侧栏共用速度，确认框只持有打开时的操作范围。 */
export function useBatchTask({ onRequestExport }: { onRequestExport: () => void }) {
  const api_fetch = useProjectFetch();
  const { t } = useI18n();
  const { active_project, project_snapshot, commit_project_write } = useDesktopState();
  const snapshot = useBatchTaskSnapshot();
  const activity_id = snapshot.activity?.id ?? null;
  const runtime_snapshot = useProjectRuntimeSnapshot();
  const [task_detail_sheet_open, set_task_detail_sheet_open] = useState(false);
  const [task_confirm_state, set_task_confirm_state] = useState<TaskConfirmation | null>(null);
  const [speed_sample, set_speed_sample] = useState<{
    activity_id: string;
    data: BatchTaskSpeed;
    now_seconds: number;
  } | null>(null);

  const current_sample = speed_sample?.activity_id === activity_id ? speed_sample : null; // 新一轮渲染先于采样时钟重启。
  const metrics = batch_task_metrics(
    snapshot,
    current_sample?.now_seconds ?? snapshot.activity?.start_time ?? 0,
  );
  const summary = build_batch_task_summary_display(metrics, current_sample?.data.speed ?? 0, t);
  const translation_active = runtime_snapshot.owner === "batch_translation";
  const translation_action_blocked =
    !project_snapshot.loaded ||
    translation_active ||
    runtime_snapshot.owner === "project_write" ||
    task_confirm_state !== null;

  /** 共用一个采样时钟，速度按单调时钟计算，累计时间沿用后端时间戳。 */
  const sample_speed = useEffectEvent((id: string) => {
    const { activity } = snapshot;
    if (activity?.id !== id) return;
    const now_seconds = Date.now() / 1000;
    const observation = {
      time: performance.now(),
      tokens: generated_batch_task_tokens(activity.usage),
    };
    set_speed_sample((previous) => ({
      activity_id: id,
      now_seconds,
      data: sample_batch_task_speed(
        previous?.activity_id === id ? previous.data : undefined,
        observation,
      ),
    }));
  });

  useEffect(() => {
    if (activity_id === null) {
      set_speed_sample(null);
      return;
    }
    sample_speed(activity_id);
    const timer = window.setInterval(
      () => sample_speed(activity_id),
      TASK_WAVEFORM_SAMPLE_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [activity_id]);

  /** 工程已加载时，任一入口都可以打开侧栏。 */
  function open_task_detail_sheet(): void {
    if (project_snapshot.loaded) set_task_detail_sheet_open(true);
  }

  /** 关闭侧栏，采样仍服务于工作台和 Agent 入口。 */
  function close_task_detail_sheet(): void {
    set_task_detail_sheet_open(false);
  }

  /** 工作台启动独立翻译，受理响应与 SSE 共用工程镜像。 */
  async function request_start_translation(): Promise<void> {
    if (translation_action_blocked) return;
    try {
      const payload = await api_fetch<Record<string, unknown>>("/api/batch-translation/start", {
        operation: "translate",
        scope: { kind: "all" },
      });
      active_project?.update_task(payload);
    } catch (error) {
      push_error_toast(t("batch_translation.feedback.start_failed"), error);
    }
  }

  /** 停止确认固定打开时还可停止的批次。 */
  function request_task_action_confirmation(kind: TaskAction): void {
    if (kind === "reset-all") {
      set_task_confirm_state({ kind, submitting: false });
      return;
    }
    const run_ids = snapshot.tasks
      .filter((task) => task.status !== "stopping")
      .map((task) => task.run_id);
    if (run_ids.length > 0) set_task_confirm_state({ kind, run_ids, submitting: false });
  }

  /** 确认框保留到提交结束，失败时允许在原范围内重试。 */
  function close_task_action_confirmation(): void {
    set_task_confirm_state((previous) => (previous?.submitting ? previous : null));
  }

  /** 停止经任务镜像回流，重置译文经工程写入回流。 */
  async function confirm_task_action(): Promise<void> {
    if (task_confirm_state === null || task_confirm_state.submitting) return;
    set_task_confirm_state({ ...task_confirm_state, submitting: true });
    try {
      if (task_confirm_state.kind === "stop") {
        const payload = await api_fetch<Record<string, unknown>>("/api/batch-task/stop", {
          run_ids: task_confirm_state.run_ids,
        });
        active_project?.update_task(payload);
      } else {
        await commit_project_write({
          operation: WORKBENCH_TRANSLATION_WRITE,
          run: () =>
            api_fetch<ProjectWriteResultPayload>("/api/workbench/translation/reset", {
              mode: "all",
            }),
        });
        push_toast("success", t("app.feedback.operation_success"));
      }
      set_task_confirm_state(null);
    } catch (error) {
      push_error_toast(
        t(
          task_confirm_state.kind === "stop"
            ? "batch_translation.feedback.stop_failed"
            : "batch_translation.feedback.reset_all_failed",
        ),
        error,
      );
      set_task_confirm_state({ ...task_confirm_state, submitting: false });
    }
  }

  const confirmation_open = task_confirm_state !== null;
  useEffect(() => {
    if (!project_snapshot.loaded || confirmation_open) return;
    const completion = active_project?.batch_task.takeTranslationCompletion();
    if (completion == null) return;
    show_translation_feedback(completion, t);
    if (completion.status === "done" && completion.operation === "translate") onRequestExport();
  }, [active_project, confirmation_open, onRequestExport, project_snapshot.loaded, snapshot, t]);

  return {
    metrics,
    summary,
    task_waveform_history: current_sample?.data.history ?? EMPTY_HISTORY,
    task_detail_sheet_open,
    task_confirm_state,
    translation_active,
    translation_action_blocked,
    open_task_detail_sheet,
    close_task_detail_sheet,
    request_start_translation,
    request_task_action_confirmation,
    confirm_task_action,
    close_task_action_confirmation,
  };
}

export type BatchTask = ReturnType<typeof useBatchTask>;

/** 会话交接独立翻译的完成通知，执行错误由后端事件上报。 */
function show_translation_feedback(completion: BatchTranslationCompletion, t: TextResolver): void {
  if (completion.status === "stopped") {
    push_toast("info", t("batch_translation.feedback.stopped"));
  } else if (completion.status === "done") {
    if (completion.failed > 0) {
      push_toast("warning", t("batch_translation.feedback.ended"), {
        persistent: true,
        description: t("batch_translation.feedback.retry_exhausted", {
          count: String(completion.failed),
        }),
      });
    } else {
      push_toast("success", t("batch_translation.feedback.done"));
    }
  }
}
