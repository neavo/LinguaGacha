import { useProjectTranslationStats } from "@frontend/app/session/project-translation-stats-context";
import { BatchTranslationDetailSheet } from "@frontend/features/batch-translation/batch-translation-detail-sheet";
import { build_translation_task_detail_display } from "@frontend/features/batch-translation/batch-translation-display";
import { useMemo, type ReactNode } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useBatchTranslationTask } from "@frontend/app/session/batch-translation/use-batch-translation-task";
import type { TranslationTaskConfirmState } from "@shared/batch-translation/batch-translation";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { useTranslationExport } from "@frontend/app/session/translation-export/translation-export-context";
import {
  type BatchTranslationSessionContextValue,
  BatchTranslationSessionContext,
} from "./batch-translation-session-context";
import { useBatchTranslationSession } from "@frontend/app/session/batch-translation/batch-translation-session-context";
import { BatchTranslationRecoveryToast } from "./batch-translation-recovery-toast";

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

  if (state.kind === "reset-failed") {
    return t("batch_translation.confirm.reset_failed_description");
  }

  return t("batch_translation.confirm.stop_description");
}

// 应用级详情先挂载，动作确认在同一浮层层级中覆盖详情。
function BatchTranslationDialogsLayer(): JSX.Element {
  const { t } = useI18n();
  const { batch_translation_task } = useBatchTranslationSession();
  const stats = useProjectTranslationStats();
  const translation_confirm_description = useMemo(() => {
    return resolve_translation_task_confirm_description(
      batch_translation_task.task_confirm_state,
      t,
    );
  }, [t, batch_translation_task.task_confirm_state]);

  return (
    <>
      <BatchTranslationDetailSheet
        empty_text={
          batch_translation_task.translation_task_metrics.active ||
          batch_translation_task.translation_task_display_snapshot !== null
            ? undefined
            : t("batch_translation.summary.empty")
        }
        open={batch_translation_task.translation_detail_sheet_open}
        display={build_translation_task_detail_display({
          config: batch_translation_task.translation_task_display_snapshot?.config,
          metrics: batch_translation_task.translation_task_metrics,
          completion_percent: stats?.completion_percent ?? null,
          waveform_history: batch_translation_task.translation_waveform_history,
          t,
        })}
        on_close={batch_translation_task.close_translation_detail_sheet}
        on_request_stop_confirmation={() =>
          batch_translation_task.request_task_action_confirmation("stop-translation")
        }
      />
      {/* 仅全量重置需要防误触，失败重置及其它任务动作保持即时确认。 */}
      <AppConfirmDialog
        open={batch_translation_task.task_confirm_state !== null}
        description={translation_confirm_description}
        submitting={batch_translation_task.task_confirm_state?.submitting ?? false}
        confirmDelay={batch_translation_task.task_confirm_state?.kind === "reset-all"}
        onConfirm={batch_translation_task.confirm_task_action}
        onClose={batch_translation_task.close_task_action_confirmation}
      />
    </>
  );
}

// 拥有跨页面任务 follow-up，页面只消费展示与动作能力。
export function BatchTranslationSessionProvider(props: { children: ReactNode }): JSX.Element {
  const translation_export = useTranslationExport();
  // 翻译任务常驻于 session 内，确保离开工作台后任务完成确认不丢失。
  const batch_translation_task = useBatchTranslationTask({
    onRequestExport: translation_export.request_export,
  });
  const context_value = useMemo<BatchTranslationSessionContextValue>(() => {
    return {
      batch_translation_task,
    };
  }, [batch_translation_task]);

  return (
    <BatchTranslationSessionContext.Provider value={context_value}>
      {props.children}
      <BatchTranslationRecoveryToast />
      <BatchTranslationDialogsLayer />
    </BatchTranslationSessionContext.Provider>
  );
}
