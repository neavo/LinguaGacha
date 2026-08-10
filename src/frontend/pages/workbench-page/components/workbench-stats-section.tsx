import { useI18n } from "@frontend/app/locale/locale-provider";
import type { WorkbenchStats, WorkbenchStatsMode } from "@frontend/pages/workbench-page/types";
import { WorkbenchStatCard } from "@frontend/pages/workbench-page/components/workbench-stat-card";

type WorkbenchStatsSectionProps = {
  stats: WorkbenchStats;
  stats_mode: WorkbenchStatsMode;
  on_toggle_stats_mode: () => void;
};

export function WorkbenchStatsSection(props: WorkbenchStatsSectionProps): JSX.Element {
  const { t } = useI18n();
  const completed_title =
    props.stats_mode === "analysis"
      ? t("task_progress.analysis_completed")
      : t("task_progress.translation_completed");
  const failed_title =
    props.stats_mode === "analysis"
      ? t("task_progress.analysis_failed")
      : t("task_progress.translation_failed");
  const pending_title =
    props.stats_mode === "analysis"
      ? t("task_progress.analysis_pending")
      : t("task_progress.translation_pending");
  const skipped_title =
    props.stats_mode === "analysis"
      ? t("task_progress.analysis_skipped")
      : t("task_progress.translation_skipped");
  const toggle_tooltip = t("task_progress.toggle_tooltip");

  return (
    <section className="workbench-page__stats-grid">
      <WorkbenchStatCard
        title={skipped_title}
        value={props.stats.skipped_count}
        unit={t("workbench_page.unit.line")}
        accent="skipped"
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
      <WorkbenchStatCard
        title={failed_title}
        value={props.stats.failed_count}
        unit={t("workbench_page.unit.line")}
        accent="failure"
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
      <WorkbenchStatCard
        title={completed_title}
        value={props.stats.completed_count}
        unit={t("workbench_page.unit.line")}
        accent="success"
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
      <WorkbenchStatCard
        title={pending_title}
        value={props.stats.pending_count}
        unit={t("workbench_page.unit.line")}
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
    </section>
  );
}
