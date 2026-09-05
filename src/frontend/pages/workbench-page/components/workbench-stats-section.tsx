import { useI18n } from "@frontend/app/locale/locale-provider";
import type { WorkbenchStats } from "@frontend/pages/workbench-page/types";
import { WorkbenchStatCard } from "@frontend/pages/workbench-page/components/workbench-stat-card";

type WorkbenchStatsSectionProps = {
  stats: WorkbenchStats;
};

export function WorkbenchStatsSection(props: WorkbenchStatsSectionProps): JSX.Element {
  const { t } = useI18n();
  const completed_title = t("task_progress.translation_completed");
  const failed_title = t("task_progress.translation_failed");
  const pending_title = t("task_progress.translation_pending");
  const skipped_title = t("task_progress.translation_skipped");

  return (
    <section className="workbench-page__stats-grid">
      <WorkbenchStatCard
        title={skipped_title}
        value={props.stats.skipped_count}
        unit={t("workbench_page.unit.line")}
        accent="skipped"
      />
      <WorkbenchStatCard
        title={failed_title}
        value={props.stats.failed_count}
        unit={t("workbench_page.unit.line")}
        accent="failure"
      />
      <WorkbenchStatCard
        title={completed_title}
        value={props.stats.completed_count}
        unit={t("workbench_page.unit.line")}
        accent="success"
      />
      <WorkbenchStatCard
        title={pending_title}
        value={props.stats.pending_count}
        unit={t("workbench_page.unit.line")}
      />
    </section>
  );
}
