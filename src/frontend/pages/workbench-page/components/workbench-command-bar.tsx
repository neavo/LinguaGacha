import { useState } from "react";
import { FileInput, FilePlus2, SquarePower, Trash2, type LucideIcon } from "lucide-react";

import { format_agent_skill_reference } from "@shared/agent";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useAgentInput } from "@frontend/app/session/agent/agent-session-context";
import type { AnalysisWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-analysis-workbench-task";
import type { TranslationWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-translation-workbench-task";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { AnalysisTaskActionKind } from "@shared/workbench/analysis-task";
import type { TranslationTaskActionKind } from "@shared/workbench/translation-task";
import type {
  WorkbenchStats,
  WorkbenchTaskSummaryDisplay,
  WorkbenchTaskViewState,
} from "@frontend/pages/workbench-page/types";
import { WorkbenchTaskMenu } from "@frontend/pages/workbench-page/components/workbench-task-menu";
import { WorkbenchTaskSummary } from "@frontend/pages/workbench-page/components/workbench-task-summary";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

/** 工作台迁移入口与 Agent 引导卡片共用统一质量规则工作流 skill。 */
const QUALITY_RULE_WORKFLOW_SKILL_NAME = "quality-rule-workflow";

type WorkbenchCommandBarProps = {
  translation_workbench_task: TranslationWorkbenchTask;
  analysis_workbench_task: AnalysisWorkbenchTask;
  active_workbench_task_view: WorkbenchTaskViewState;
  active_workbench_task_summary: WorkbenchTaskSummaryDisplay;
  translation_stats: WorkbenchStats;
  analysis_stats: WorkbenchStats;
  can_edit_files: boolean;
  can_delete_selected_files: boolean;
  can_generate_translation: boolean;
  can_close_project: boolean;
  on_add_file: () => void;
  on_delete_selected: () => void;
  on_generate_translation: () => void;
  on_close_project: () => void;
};

type CommandAction = {
  id: "add-file" | "delete-file" | "generate-translation" | "close-project";
  icon: LucideIcon;
  label_key: LocaleKey;
  disabled: boolean;
  on_click: () => void;
};

/**
 * 汇总文件操作与两类常驻任务的入口，不在视图层复制任务状态机。
 */
export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { navigate_to_route } = useAppNavigation();
  const agent_input = useAgentInput();
  const model_selection = useModelSelection();
  // 迁移提醒每次启动经典分析时重新显示，不持久化已读状态。
  const [analysis_migration_dialog_open, set_analysis_migration_dialog_open] = useState(false);
  const active_translation_task_action_kind: TranslationTaskActionKind | null =
    props.translation_workbench_task.task_confirm_state?.kind ?? null;
  const active_analysis_task_action_kind: AnalysisTaskActionKind | null =
    props.analysis_workbench_task.analysis_confirm_state?.kind ?? null;
  // 摘要卡只认识统一的打开意图，实际详情面板由当前任务会话决定。
  const handle_open_task_detail =
    props.active_workbench_task_view.task_kind === "analysis"
      ? props.analysis_workbench_task.open_analysis_detail_sheet
      : props.active_workbench_task_view.task_kind === "translation"
        ? props.translation_workbench_task.open_translation_detail_sheet
        : () => {};
  const task_summary_auto_open_key =
    props.active_workbench_task_view.can_open_detail &&
    props.active_workbench_task_view.task_kind !== null &&
    props.active_workbench_task_summary.show_spinner
      ? props.active_workbench_task_view.task_kind
      : null;
  const add_file_disabled = !props.can_edit_files;
  const delete_file_disabled = !props.can_delete_selected_files;
  const actions: CommandAction[] = [
    {
      id: "add-file",
      icon: FilePlus2,
      label_key: "workbench_page.action.add_file",
      disabled: add_file_disabled,
      on_click: props.on_add_file,
    },
    {
      id: "delete-file",
      icon: Trash2,
      label_key: "app.action.delete",
      disabled: delete_file_disabled,
      on_click: props.on_delete_selected,
    },
    {
      id: "generate-translation",
      icon: FileInput,
      label_key: "workbench_page.action.generate_translation",
      disabled: !props.can_generate_translation,
      on_click: props.on_generate_translation,
    },
    {
      id: "close-project",
      icon: SquarePower,
      label_key: "workbench_page.action.close_project",
      disabled: !props.can_close_project,
      on_click: props.on_close_project,
    },
  ];

  useActionShortcut({
    action: "create",
    enabled: !add_file_disabled,
    on_trigger: props.on_add_file,
  });
  useActionShortcut({
    action: "delete",
    enabled: !delete_file_disabled,
    on_trigger: props.on_delete_selected,
  });

  /** 每次请求启动经典分析都先展示迁移提醒。 */
  function request_classic_analysis(): Promise<void> {
    set_analysis_migration_dialog_open(true);
    return Promise.resolve();
  }

  /** 关闭迁移提醒后仍复用经典分析任务的唯一启动入口。 */
  function continue_classic_analysis(): void {
    set_analysis_migration_dialog_open(false);
    void props.analysis_workbench_task.request_start_or_continue_analysis();
  }

  /** 跳转前只填充空草稿，避免覆盖 Agent 跨路由保留的用户输入。 */
  function jump_to_agent(): void {
    const draft = agent_input.read_draft();
    if (draft.text.trim() === "" && draft.attachments.length === 0) {
      agent_input.write_draft({
        text: `${t("agent_page.empty.suggestions.quality_rule_workflow")} ${format_agent_skill_reference(QUALITY_RULE_WORKFLOW_SKILL_NAME)}`,
        attachments: [],
      });
    } else {
      push_toast("info", t("workbench_page.analysis_task.feedback.agent_draft_preserved"));
    }

    set_analysis_migration_dialog_open(false);
    navigate_to_route("agent");
  }

  return (
    <CommandBar
      className="workbench-page__task-command-bar"
      actions={
        <>
          <CommandBarGroup>
            <WorkbenchTaskMenu
              task_kind="translation"
              active={props.translation_workbench_task.translation_task_metrics.active}
              workbench_stats={props.translation_stats}
              disabled={props.translation_workbench_task.translation_task_menu_disabled}
              busy={props.translation_workbench_task.translation_task_menu_busy}
              model_selection={model_selection}
              active_task_action_kind={active_translation_task_action_kind}
              on_start_or_continue={
                props.translation_workbench_task.request_start_or_continue_translation
              }
              on_request_reset={props.translation_workbench_task.request_task_action_confirmation}
            />
            <WorkbenchTaskMenu
              task_kind="analysis"
              active={props.analysis_workbench_task.analysis_task_metrics.active}
              workbench_stats={props.analysis_stats}
              disabled={props.analysis_workbench_task.analysis_task_menu_disabled}
              busy={props.analysis_workbench_task.analysis_task_menu_busy}
              model_selection={model_selection}
              active_task_action_kind={active_analysis_task_action_kind}
              on_start_or_continue={request_classic_analysis}
              on_request_reset={
                props.analysis_workbench_task.request_analysis_task_action_confirmation
              }
              analysis_import={{
                candidate_count:
                  props.analysis_workbench_task.analysis_task_metrics.candidate_count,
                importing: props.analysis_workbench_task.analysis_importing,
                on_request: () => {
                  props.analysis_workbench_task.request_analysis_task_action_confirmation(
                    "import-glossary",
                  );
                },
              }}
            />
          </CommandBarGroup>
          <CommandBarSeparator />
          {actions.map((action, index) => {
            const Icon = action.icon;
            const should_render_separator = index > 0 && action.id !== "delete-file";

            return (
              <div key={action.id} className="contents">
                {should_render_separator ? <CommandBarSeparator /> : null}
                <AppButton
                  variant="ghost"
                  size="toolbar"
                  disabled={action.disabled}
                  onClick={action.on_click}
                >
                  <Icon data-icon="inline-start" />
                  {t(action.label_key)}
                  {action.id === "add-file" ? <ShortcutKbd action="create" /> : null}
                  {action.id === "delete-file" ? <ShortcutKbd action="delete" /> : null}
                </AppButton>
              </div>
            );
          })}
          <AppActionDialog
            open={analysis_migration_dialog_open}
            description={t("workbench_page.analysis_task.migration.description")}
            primaryAction={{
              label: t("app.action.continue_task"),
              onSelect: continue_classic_analysis,
            }}
            secondaryAction={{
              label: t("app.action.go_to_agent"),
              onSelect: jump_to_agent,
            }}
            onClose={() => set_analysis_migration_dialog_open(false)}
          />
        </>
      }
      hint={
        <WorkbenchTaskSummary
          class_name="workbench-page__task-summary"
          display={props.active_workbench_task_summary}
          can_open={props.active_workbench_task_view.can_open_detail}
          auto_open_key={task_summary_auto_open_key}
          on_open={handle_open_task_detail}
        />
      }
    />
  );
}
