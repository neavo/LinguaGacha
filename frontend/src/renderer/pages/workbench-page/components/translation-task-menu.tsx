import { BrushCleaning, Paintbrush, Play, ScanText } from "lucide-react";

import "@/pages/workbench-page/components/task-runtime/task-runtime.css";
import { useI18n } from "@/i18n";
import {
  type TranslationTaskActionKind,
  type TranslationTaskMetrics,
} from "@/pages/workbench-page/task-runtime/translation-task-model";
import type { WorkbenchStats } from "@/pages/workbench-page/types";
import { WorkbenchSegmentedProgress } from "@/pages/workbench-page/components/workbench-segmented-progress";
import { AppButton } from "@/widgets/app-button/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { Spinner } from "@/shadcn/spinner";

type TranslationTaskMenuProps = {
  translation_task_metrics: TranslationTaskMetrics;
  workbench_stats: WorkbenchStats;
  disabled: boolean;
  busy: boolean;
  active_task_action_kind: TranslationTaskActionKind | null;
  on_start_or_continue: () => Promise<void>;
  on_request_confirmation: (kind: TranslationTaskActionKind) => void;
};

export function TranslationTaskMenu(props: TranslationTaskMenuProps): JSX.Element {
  const { t } = useI18n();
  const action_items_disabled =
    props.translation_task_metrics.active || props.busy || props.disabled;
  const progress_percent = props.workbench_stats.completion_percent;
  const trigger_icon = <ScanText data-icon="inline-start" />;
  const main_action_icon = <Play data-icon="inline-start" />;

  return (
    <AppDropdownMenu>
      <AppDropdownMenuTrigger asChild>
        <AppButton type="button" size="toolbar" variant="ghost" disabled={props.disabled}>
          {trigger_icon}
          {t("workbench_page.action.translation_task")}
        </AppButton>
      </AppDropdownMenuTrigger>

      <AppDropdownMenuContent align="start" className="task-runtime__menu">
        <div className="task-runtime__menu-progress">
          <div className="task-runtime__menu-progress-head">
            <span className="task-runtime__menu-progress-label">
              {t("workbench_page.translation_task.menu.progress")}
            </span>
            <span className="task-runtime__menu-progress-value">
              {progress_percent.toFixed(2)}%
            </span>
          </div>
          <WorkbenchSegmentedProgress
            stats={props.workbench_stats}
            labels={{
              skipped: t("workbench_page.stats.translation_skipped"),
              failed: t("workbench_page.stats.error_count"),
              completed: t("workbench_page.stats.translated"),
              pending: t("workbench_page.stats.untranslated"),
              total: t("workbench_page.stats.total_lines"),
            }}
          />
        </div>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            disabled={action_items_disabled}
            onSelect={() => {
              void props.on_start_or_continue();
            }}
          >
            {props.translation_task_metrics.active ? (
              <Spinner data-icon="inline-start" />
            ) : (
              main_action_icon
            )}
            {t("workbench_page.action.start_translation")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_confirmation("reset-all");
            }}
          >
            {props.active_task_action_kind === "reset-all" && props.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <BrushCleaning data-icon="inline-start" />
            )}
            {t("workbench_page.action.reset_translation_all")}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_confirmation("reset-failed");
            }}
          >
            {props.active_task_action_kind === "reset-failed" && props.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Paintbrush data-icon="inline-start" />
            )}
            {t("workbench_page.action.reset_translation_failed")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
