import { useI18n } from '@/i18n'
import type { WorkbenchStats } from '@/pages/workbench-page/types'
import { WorkbenchStatCard } from '@/pages/workbench-page/components/WorkbenchStatCard'

type WorkbenchStatsSectionProps = {
  stats: WorkbenchStats
}

export function WorkbenchStatsSection(props: WorkbenchStatsSectionProps): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="workbench-page__stats-grid" aria-label={t('task.page.workbench.section.stats')}>
      <WorkbenchStatCard
        title={t('task.page.workbench.stats.file_count')}
        value={props.stats.file_count}
        unit={t('task.page.workbench.unit.file')}
      />
      <WorkbenchStatCard
        title={t('task.page.workbench.stats.total_lines')}
        value={props.stats.total_items}
        unit={t('task.page.workbench.unit.line')}
      />
      <WorkbenchStatCard
        title={t('task.page.workbench.stats.translated')}
        value={props.stats.translated}
        unit={t('task.page.workbench.unit.line')}
        accent="success"
      />
      <WorkbenchStatCard
        title={t('task.page.workbench.stats.untranslated')}
        value={props.stats.untranslated}
        unit={t('task.page.workbench.unit.line')}
        accent="warning"
      />
    </section>
  )
}
