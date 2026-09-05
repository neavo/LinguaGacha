import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  useTranslationWorkbenchTask,
  type TranslationWorkbenchTask,
} from "@frontend/app/session/batch-translation/use-translation-workbench-task";
import type { TranslationTaskConfirmState } from "@shared/workbench/batch-translation";

import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { TranslationExportDialog } from "@frontend/features/translation-export/translation-export-dialog";
import {
  useTranslationExportFlow,
  type TranslationExportFlow,
} from "@frontend/features/translation-export/use-translation-export-flow";

type BatchTranslationSessionContextValue = {
  translation_workbench_task: TranslationWorkbenchTask; // 常驻监听翻译任务完成意图
  translation_export: TranslationExportFlow; // 手动与任务完成提示共用唯一导出流程
};

// 保留工作台任务 follow-up 的跨页面运行态。
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
    return t("workbench_page.translation_task.confirm.reset_all_description");
  }

  if (state.kind === "reset-failed") {
    return t("workbench_page.translation_task.confirm.reset_failed_description");
  }

  return t("workbench_page.translation_task.confirm.stop_description");
}

// 常驻渲染任务完成后的用户确认，不依赖工作台页面是否挂载。
function BatchTranslationFollowupDialogsLayer(): JSX.Element {
  const { t } = useI18n();
  const { translation_workbench_task, translation_export } = useBatchTranslationSession();
  const translation_confirm_description = useMemo(() => {
    return resolve_translation_task_confirm_description(
      translation_workbench_task.task_confirm_state,
      t,
    );
  }, [t, translation_workbench_task.task_confirm_state]);

  return (
    <>
      {/* 仅全量重置需要防误触，失败重置及其它任务动作保持即时确认。 */}
      <AppConfirmDialog
        open={translation_workbench_task.task_confirm_state?.open ?? false}
        description={translation_confirm_description}
        submitting={translation_workbench_task.task_confirm_state?.submitting ?? false}
        confirmDelay={translation_workbench_task.task_confirm_state?.kind === "reset-all"}
        onConfirm={translation_workbench_task.confirm_task_action}
        onClose={translation_workbench_task.close_task_action_confirmation}
      />

      <TranslationExportDialog {...translation_export} />
    </>
  );
}

// 拥有跨页面任务 follow-up，页面只消费展示与动作能力。
export function BatchTranslationSessionProvider(props: { children: ReactNode }): JSX.Element {
  const translation_export = useTranslationExportFlow();
  // 翻译任务常驻于 session 内，确保离开工作台后任务完成确认不丢失。
  const translation_workbench_task = useTranslationWorkbenchTask({
    onRequestExport: translation_export.request_export,
  });
  const context_value = useMemo<BatchTranslationSessionContextValue>(() => {
    return {
      translation_workbench_task,
      translation_export,
    };
  }, [translation_export, translation_workbench_task]);

  return (
    <BatchTranslationSessionContext.Provider value={context_value}>
      {props.children}
      <BatchTranslationFollowupDialogsLayer />
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
