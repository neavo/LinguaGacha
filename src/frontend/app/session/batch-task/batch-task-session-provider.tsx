import { BatchTaskDetailSheet } from "@frontend/features/batch-task/batch-task-detail-sheet";
import { build_translation_task_detail_display } from "@frontend/features/batch-task/batch-task-display";
import { type JSX, useMemo, type ReactNode } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useBatchTask } from "@frontend/app/session/batch-task/use-batch-task";
import type { TranslationTaskConfirmState } from "@shared/batch-translation/batch-translation";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { useTranslationExport } from "@frontend/app/session/translation-export/translation-export-context";
import {
  type BatchTaskSessionContextValue,
  BatchTaskSessionContext,
} from "./batch-task-session-context";
import { useBatchTaskSession } from "@frontend/app/session/batch-task/batch-task-session-context";
import { BatchTaskRecoveryToast } from "./batch-task-recovery-toast";

/** 将翻译任务动作收口为确认框可见文案。 */
function resolve_translation_task_confirm_description(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (state === null) {
    return "";
  }

  if (state.kind === "reset-all") {
    return t("batch_translation.confirm.reset_all_description");
  }

  return t("batch_translation.confirm.stop_description");
}

/** 应用级详情先挂载，动作确认在同一浮层层级中覆盖详情。 */
function BatchTranslationDialogsLayer(): JSX.Element {
  const { t } = useI18n();
  const { batch_task } = useBatchTaskSession();

  return (
    <>
      <BatchTaskDetailSheet
        empty_text={
          batch_task.task_metrics.total !== 0 &&
          (batch_task.task_metrics.active || batch_task.task_display_snapshot !== null)
            ? undefined
            : t("batch_translation.summary.empty")
        }
        open={batch_task.task_detail_sheet_open}
        display={build_translation_task_detail_display({
          config: batch_task.task_display_snapshot?.config ?? undefined,
          metrics: batch_task.task_metrics,
          completion_percent: batch_task.task_metrics.completion_percent,
          waveform_history: batch_task.task_waveform_history,
          t,
        })}
        on_close={batch_task.close_task_detail_sheet}
        on_request_stop_confirmation={() =>
          batch_task.request_task_action_confirmation("stop-translation")
        }
      />
      {/* 重置会批量清空译文，需要倒计时防误触，其它任务动作保持即时确认。 */}
      <AppConfirmDialog
        open={batch_task.task_confirm_state !== null}
        description={resolve_translation_task_confirm_description(batch_task.task_confirm_state, t)}
        submitting={batch_task.task_confirm_state?.submitting ?? false}
        confirmDelay={batch_task.task_confirm_state?.kind === "reset-all"}
        onConfirm={batch_task.confirm_task_action}
        onClose={batch_task.close_task_action_confirmation}
      />
    </>
  );
}

/** 在应用会话内持有翻译任务，页面共同消费展示与动作能力。 */
export function BatchTaskSessionProvider(props: { children: ReactNode }): JSX.Element {
  const translation_export = useTranslationExport();
  // 翻译任务常驻于 session 内，确保离开工作台后任务完成确认不丢失。
  const batch_task = useBatchTask({
    onRequestExport: translation_export.request_export,
  });
  const context_value = useMemo<BatchTaskSessionContextValue>(() => {
    return {
      batch_task,
    };
  }, [batch_task]);

  return (
    <BatchTaskSessionContext.Provider value={context_value}>
      {props.children}
      <BatchTaskRecoveryToast />
      <BatchTranslationDialogsLayer />
    </BatchTaskSessionContext.Provider>
  );
}
