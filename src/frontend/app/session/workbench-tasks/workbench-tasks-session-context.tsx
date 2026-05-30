import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  useAnalysisWorkbenchTask,
  type AnalysisWorkbenchTask,
} from "@frontend/app/session/workbench-tasks/use-analysis-workbench-task";
import {
  useTranslationWorkbenchTask,
  type TranslationWorkbenchTask,
} from "@frontend/app/session/workbench-tasks/use-translation-workbench-task";
import type { AnalysisTaskConfirmState } from "@shared/workbench/analysis-task";
import type { TranslationTaskConfirmState } from "@shared/workbench/translation-task";
import type { WorkbenchTaskConfirmDialogDisplay } from "@frontend/pages/workbench-page/types";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { QualityRuleImportConfirmDialog } from "@frontend/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-dialog";

type WorkbenchTasksSessionContextValue = {
  translation_workbench_task: TranslationWorkbenchTask; // 常驻监听翻译任务完成意图
  analysis_workbench_task: AnalysisWorkbenchTask; // 常驻监听分析任务完成意图
};

// WorkbenchTasksSessionContext 保留工作台任务 follow-up 的跨页面运行态。
const WorkbenchTasksSessionContext = createContext<WorkbenchTasksSessionContextValue | null>(null);

// build_translation_task_confirm_dialog_display 构造跨层载荷，保证字段形状在一个入口维护。
function build_translation_task_confirm_dialog_display(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskConfirmDialogDisplay | null {
  if (state === null) {
    return null;
  }

  if (state.kind === "reset-all") {
    return {
      open: state.open,
      description: t("workbench_page.translation_task.confirm.reset_all_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "reset-failed") {
    return {
      open: state.open,
      description: t("workbench_page.translation_task.confirm.reset_failed_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "generate-translation") {
    return {
      open: state.open,
      description: t("workbench_page.translation_task.confirm.generate_description"),
      submitting: state.submitting,
    };
  }

  return {
    open: state.open,
    description: t("workbench_page.translation_task.confirm.stop_description"),
    submitting: state.submitting,
  };
}

// build_analysis_task_confirm_dialog_display 构造跨层载荷，保证字段形状在一个入口维护。
function build_analysis_task_confirm_dialog_display(
  state: AnalysisTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskConfirmDialogDisplay | null {
  if (state === null) {
    return null;
  }

  if (state.kind === "reset-all") {
    return {
      open: state.open,
      description: t("workbench_page.analysis_task.confirm.reset_all_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "reset-failed") {
    return {
      open: state.open,
      description: t("workbench_page.analysis_task.confirm.reset_failed_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "import-glossary") {
    return {
      open: state.open,
      description: t("workbench_page.analysis_task.confirm.import_glossary_description"),
      submitting: state.submitting,
    };
  }

  return {
    open: state.open,
    description: t("workbench_page.analysis_task.confirm.stop_description"),
    submitting: state.submitting,
  };
}

// WorkbenchTasksFollowupDialogsLayer 常驻渲染任务完成后的用户确认，不依赖工作台页面是否挂载。
function WorkbenchTasksFollowupDialogsLayer(): JSX.Element {
  const { t } = useI18n();
  const { translation_workbench_task, analysis_workbench_task } = useWorkbenchTasksSession();
  const translation_task_confirm_dialog = useMemo<WorkbenchTaskConfirmDialogDisplay | null>(() => {
    return build_translation_task_confirm_dialog_display(
      translation_workbench_task.task_confirm_state,
      t,
    );
  }, [t, translation_workbench_task.task_confirm_state]);
  const analysis_task_confirm_dialog = useMemo<WorkbenchTaskConfirmDialogDisplay | null>(() => {
    return build_analysis_task_confirm_dialog_display(
      analysis_workbench_task.analysis_confirm_state,
      t,
    );
  }, [analysis_workbench_task.analysis_confirm_state, t]);

  return (
    <>
      <AppAlertDialog
        open={translation_task_confirm_dialog?.open ?? false}
        description={translation_task_confirm_dialog?.description ?? ""}
        submitting={translation_task_confirm_dialog?.submitting ?? false}
        onConfirm={translation_workbench_task.confirm_task_action}
        onClose={translation_workbench_task.close_task_action_confirmation}
      />
      <AppAlertDialog
        open={analysis_task_confirm_dialog?.open ?? false}
        description={analysis_task_confirm_dialog?.description ?? ""}
        submitting={analysis_task_confirm_dialog?.submitting ?? false}
        onConfirm={analysis_workbench_task.confirm_analysis_task_action}
        onClose={analysis_workbench_task.close_analysis_task_action_confirmation}
      />
      <QualityRuleImportConfirmDialog
        state={analysis_workbench_task.analysis_import_confirm_state}
        on_skip={analysis_workbench_task.import_analysis_glossary_duplicate_skip}
        on_overwrite={analysis_workbench_task.import_analysis_glossary_duplicate_overwrite}
        on_close={analysis_workbench_task.close_analysis_glossary_import_confirmation}
      />
    </>
  );
}

// WorkbenchTasksSessionProvider 拥有跨页面任务 follow-up，页面只消费展示与动作能力。
export function WorkbenchTasksSessionProvider(props: { children: ReactNode }): JSX.Element {
  // 翻译任务常驻于 session 内，确保离开工作台后任务完成确认不丢失。
  const translation_workbench_task = useTranslationWorkbenchTask();
  // 分析任务同样常驻，承接分析完成后的导入术语确认流程。
  const analysis_workbench_task = useAnalysisWorkbenchTask();
  const context_value = useMemo<WorkbenchTasksSessionContextValue>(() => {
    return {
      translation_workbench_task,
      analysis_workbench_task,
    };
  }, [analysis_workbench_task, translation_workbench_task]);

  return (
    <WorkbenchTasksSessionContext.Provider value={context_value}>
      {props.children}
      <WorkbenchTasksFollowupDialogsLayer />
    </WorkbenchTasksSessionContext.Provider>
  );
}

// useWorkbenchTasksSession 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
export function useWorkbenchTasksSession(): WorkbenchTasksSessionContextValue {
  const context_value = useContext(WorkbenchTasksSessionContext);
  if (context_value === null) {
    throw new Error("useWorkbenchTasksSession must be used inside WorkbenchTasksSessionProvider.");
  }

  return context_value;
}
