import { useI18n } from '@/i18n'
import type {
  WorkbenchStats,
  WorkbenchStatsMode,
} from '@/pages/workbench-page/types'
import { WorkbenchStatCard } from '@/pages/workbench-page/components/workbench-stat-card'

type WorkbenchStatsSectionProps = {
  stats: WorkbenchStats
  stats_mode: WorkbenchStatsMode
  on_toggle_stats_mode: () => void
}

export function WorkbenchStatsSection(props: WorkbenchStatsSectionProps): JSX.Element {
  const { t } = useI18n()
  const completed_title = props.stats_mode === 'analysis'
    ? t('workbench_page.stats.analysis_completed')
    : t('workbench_page.stats.translated')
  const failed_title = props.stats_mode === 'analysis'
    ? t('workbench_page.stats.analysis_failed')
    : t('workbench_page.stats.error_count')
  const pending_title = props.stats_mode === 'analysis'
    ? t('workbench_page.stats.analysis_pending')
    : t('workbench_page.stats.untranslated')
  const toggle_tooltip = t('workbench_page.stats.toggle_tooltip')

  return (
    <section className="workbench-page__stats-grid" aria-label={t('workbench_page.section.stats')}>
      <WorkbenchStatCard
        title={completed_title}
        value={props.stats.completed_count}
        unit={t('workbench_page.unit.line')}
        accent="success"
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
      <WorkbenchStatCard
        title={failed_title}
        value={props.stats.failed_count}
        unit={t('workbench_page.unit.line')}
        accent="warning"
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
      <WorkbenchStatCard
        title={pending_title}
        value={props.stats.pending_count}
        unit={t('workbench_page.unit.line')}
        toggle_tooltip={toggle_tooltip}
        on_toggle={props.on_toggle_stats_mode}
      />
      <WorkbenchStatCard
        title={t('workbench_page.stats.total_lines')}
        value={props.stats.total_items}
        unit={t('workbench_page.unit.line')}
      />
    </section>
  )
}

