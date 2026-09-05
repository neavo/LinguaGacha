import { BatchTranslationDetailSheet } from "@frontend/features/batch-translation/batch-translation-detail-sheet";
import { build_translation_task_detail_display } from "@frontend/features/batch-translation/batch-translation-display";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  useBatchTranslationTask,
  type BatchTranslationTask,
} from "@frontend/app/session/batch-translation/use-batch-translation-task";
import type { TranslationTaskConfirmState } from "@shared/batch-translation/batch-translation";

import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { TranslationExportDialog } from "@frontend/features/translation-export/translation-export-dialog";
import {
  useTranslationExportFlow,
  type TranslationExportFlow,
} from "@frontend/features/translation-export/use-translation-export-flow";

type BatchTranslationSessionContextValue = {
  batch_translation_task: BatchTranslationTask; // 常驻监听翻译任务完成意图
  translation_export: TranslationExportFlow; // 手动与任务完成提示共用唯一导出流程
};

// 当前项目的任务交互随应用 session 常驻。
const BatchTranslationSessionContext = createContext<BatchTranslationSessionContextValue | null>(
  null,
);

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
  const { batch_translation_task, translation_export } = useBatchTranslationSession();
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

      <TranslationExportDialog {...translation_export} />
    </>
  );
}

// 拥有跨页面任务 follow-up，页面只消费展示与动作能力。
export function BatchTranslationSessionProvider(props: { children: ReactNode }): JSX.Element {
  const translation_export = useTranslationExportFlow();
  // 翻译任务常驻于 session 内，确保离开工作台后任务完成确认不丢失。
  const batch_translation_task = useBatchTranslationTask({
    onRequestExport: translation_export.request_export,
  });
  const context_value = useMemo<BatchTranslationSessionContextValue>(() => {
    return {
      batch_translation_task,
      translation_export,
    };
  }, [translation_export, batch_translation_task]);

  return (
    <BatchTranslationSessionContext.Provider value={context_value}>
      {props.children}
      <BatchTranslationDialogsLayer />
    </BatchTranslationSessionContext.Provider>
  );
}

// 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
export function useBatchTranslationSession(): BatchTranslationSessionContextValue {
  const context_value = useContext(BatchTranslationSessionContext);
  if (context_value === null) {
    throw new Error(
      "useBatchTranslationSession must be used inside BatchTranslationSessionProvider.",
    );
  }

  return context_value;
}
