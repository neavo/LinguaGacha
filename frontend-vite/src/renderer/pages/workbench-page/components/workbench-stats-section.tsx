import { useI18n } from '@/i18n'
import type { WorkbenchStats } from '@/pages/workbench-page/types'
import { WorkbenchStatCard } from '@/pages/workbench-page/components/workbench-stat-card'

type WorkbenchStatsSectionProps = {
  stats: WorkbenchStats
}

export function WorkbenchStatsSection(props: WorkbenchStatsSectionProps): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="workbench-page__stats-grid" aria-label={t('workbench_page.section.stats')}>
      <WorkbenchStatCard
        title={t('workbench_page.stats.file_count')}
        value={props.stats.file_count}
        unit={t('workbench_page.unit.file')}
      />
      <WorkbenchStatCard
        title={t('workbench_page.stats.total_lines')}
        value={props.stats.total_items}
        unit={t('workbench_page.unit.line')}
      />
      <WorkbenchStatCard
        title={t('workbench_page.stats.translated')}
        value={props.stats.translated}
        unit={t('workbench_page.unit.line')}
        accent="success"
      />
      <WorkbenchStatCard
        title={t('workbench_page.stats.untranslated')}
        value={props.stats.untranslated}
        unit={t('workbench_page.unit.line')}
        accent="warning"
      />
    </section>
  )
}

