import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useI18n } from "@/app/locale/locale-provider";
import { TaskRuntimeConfirmDialog } from "@/pages/workbench-page/components/task-runtime/task-runtime-confirm-dialog";
import {
  useAnalysisTaskRuntime,
  type AnalysisTaskRuntime,
} from "@/pages/workbench-page/task-runtime/use-analysis-task-runtime";
import {
  useTranslationTaskRuntime,
  type TranslationTaskRuntime,
} from "@/pages/workbench-page/task-runtime/use-translation-task-runtime";
import type { AnalysisTaskConfirmState } from "@/pages/workbench-page/task-runtime/analysis-task-model";
import type { TranslationTaskConfirmState } from "@/pages/workbench-page/task-runtime/translation-task-model";
import type { WorkbenchTaskConfirmDialogViewModel } from "@/pages/workbench-page/types";
import { QualityRuleImportConfirmDialog } from "@/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-dialog";

type WorkbenchTaskRuntimeContextValue = {
  translation_task_runtime: TranslationTaskRuntime; // translation_task_runtime 常驻监听翻译任务完成意图
  analysis_task_runtime: AnalysisTaskRuntime; // analysis_task_runtime 常驻监听分析任务完成意图
};

// WorkbenchTaskRuntimeContext 保留工作台任务 follow-up 的跨页面运行态。
const WorkbenchTaskRuntimeContext = createContext<WorkbenchTaskRuntimeContextValue | null>(null);

// build_translation_task_confirm_dialog_view_model 构造跨层载荷，保证字段形状在一个入口维护。
function build_translation_task_confirm_dialog_view_model(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskConfirmDialogViewModel | null {
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

// build_analysis_task_confirm_dialog_view_model 构造跨层载荷，保证字段形状在一个入口维护。
function build_analysis_task_confirm_dialog_view_model(
  state: AnalysisTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskConfirmDialogViewModel | null {
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

// WorkbenchTaskFollowupDialogsLayer 常驻渲染任务完成后的用户确认，不依赖工作台页面是否挂载。
function WorkbenchTaskFollowupDialogsLayer(): JSX.Element {
  const { t } = useI18n();
  const { translation_task_runtime, analysis_task_runtime } = useWorkbenchTaskRuntime();
  const translation_task_confirm_dialog =
    useMemo<WorkbenchTaskConfirmDialogViewModel | null>(() => {
      return build_translation_task_confirm_dialog_view_model(
        translation_task_runtime.task_confirm_state,
        t,
      );
    }, [t, translation_task_runtime.task_confirm_state]);
  const analysis_task_confirm_dialog = useMemo<WorkbenchTaskConfirmDialogViewModel | null>(() => {
    return build_analysis_task_confirm_dialog_view_model(
      analysis_task_runtime.analysis_confirm_state,
      t,
    );
  }, [analysis_task_runtime.analysis_confirm_state, t]);

  return (
    <>
      <TaskRuntimeConfirmDialog
        view_model={translation_task_confirm_dialog}
        on_confirm={translation_task_runtime.confirm_task_action}
        on_close={translation_task_runtime.close_task_action_confirmation}
      />
      <TaskRuntimeConfirmDialog
        view_model={analysis_task_confirm_dialog}
        on_confirm={analysis_task_runtime.confirm_analysis_task_action}
        on_close={analysis_task_runtime.close_analysis_task_action_confirmation}
      />
      <QualityRuleImportConfirmDialog
        state={analysis_task_runtime.analysis_import_confirm_state}
        on_skip={analysis_task_runtime.import_analysis_glossary_duplicate_skip}
        on_overwrite={analysis_task_runtime.import_analysis_glossary_duplicate_overwrite}
        on_close={analysis_task_runtime.close_analysis_glossary_import_confirmation}
      />
    </>
  );
}

// WorkbenchTaskRuntimeProvider 拥有跨页面任务 follow-up，页面只消费展示与动作能力。
export function WorkbenchTaskRuntimeProvider(props: { children: ReactNode }): JSX.Element {
  // translation_task_runtime 常驻于 session 内，确保离开工作台后任务完成确认不丢失。
  const translation_task_runtime = useTranslationTaskRuntime();
  // analysis_task_runtime 同样常驻，承接分析完成后的导入术语确认流程。
  const analysis_task_runtime = useAnalysisTaskRuntime();
  const context_value = useMemo<WorkbenchTaskRuntimeContextValue>(() => {
    return {
      translation_task_runtime,
      analysis_task_runtime,
    };
  }, [analysis_task_runtime, translation_task_runtime]);

  return (
    <WorkbenchTaskRuntimeContext.Provider value={context_value}>
      {props.children}
      <WorkbenchTaskFollowupDialogsLayer />
    </WorkbenchTaskRuntimeContext.Provider>
  );
}

// useWorkbenchTaskRuntime 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
export function useWorkbenchTaskRuntime(): WorkbenchTaskRuntimeContextValue {
  const context_value = useContext(WorkbenchTaskRuntimeContext);
  if (context_value === null) {
    throw new Error("useWorkbenchTaskRuntime must be used inside WorkbenchTaskRuntimeProvider.");
  }

  return context_value;
}
