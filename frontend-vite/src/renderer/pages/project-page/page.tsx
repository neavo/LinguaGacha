import { File, FilePlus, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { project_page_mock, type ProjectRecentProject } from '@/pages/project-page/mock'
import { cn } from '@/lib/utils'

type ProjectPageProps = {
  is_sidebar_collapsed: boolean
}

type PanelHeaderProps = {
  accent_class_name: string
  title: string
  subtitle: string
}

type DropZoneCardProps = {
  icon: 'source' | 'project'
  title: string
  tone: 'blue' | 'purple'
}

type FormatSupportCardProps = {
  title: string
  extensions: string
}

type RecentProjectRowProps = {
  project: ProjectRecentProject
  on_select: (project: ProjectRecentProject) => void
}

type ProjectPreviewPanelProps = {
  project: ProjectRecentProject
}

function PanelHeader(props: PanelHeaderProps): JSX.Element {
  return (
    <CardHeader className="project-home__panel-header">
      <div className="flex items-start gap-3">
        <span className={cn('project-home__section-rail', props.accent_class_name)} aria-hidden="true" />
        <div className="space-y-2">
          <CardTitle className="text-[clamp(1.62rem,1.48rem+0.34vw,1.92rem)] leading-[1.08] tracking-[-0.028em]">
            {props.title}
          </CardTitle>
          <CardDescription className="max-w-[520px] text-[0.8rem] leading-[1.45] text-[color:var(--project-home-subtitle)]">
            {props.subtitle}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  )
}

function DropZoneCard(props: DropZoneCardProps): JSX.Element {
  const Icon = props.icon === 'source' ? FilePlus : File

  return (
    <div
      className={cn(
        'project-home__dropzone flex flex-col items-center justify-center text-center',
        props.tone === 'blue' ? 'project-home__dropzone--blue' : 'project-home__dropzone--purple',
        'h-[145px] px-5 py-4',
      )}
      role="button"
      tabIndex={0}
      aria-disabled="true"
    >
      <span className="project-home__dropzone-icon">
        <Icon className="size-12 stroke-[1.8]" />
      </span>
      <p className="mt-2.5 text-[0.96rem] font-semibold tracking-[-0.018em] text-foreground">
        {props.title}
      </p>
    </div>
  )
}

function FormatSupportCard(props: FormatSupportCardProps): JSX.Element {
  return (
    <Card className="project-home__format-card">
      <CardContent className="space-y-0.5 px-3 py-3">
        <h3 className="text-[0.78rem] leading-[1.35] font-semibold tracking-[-0.015em] text-foreground">{props.title}</h3>
        <p className="text-[0.72rem] leading-[1.35] text-[color:var(--project-home-muted)]">{props.extensions}</p>
      </CardContent>
    </Card>
  )
}

function RecentProjectRow(props: RecentProjectRowProps): JSX.Element {
  return (
    <button className="project-home__recent-row" onClick={() => props.on_select(props.project)}>
      <span className="project-home__recent-icon">
        <File className="size-[18px] stroke-[1.8]" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[0.76rem] font-bold tracking-[-0.012em] text-foreground">{props.project.name}</span>
        <span className="mt-0.5 block truncate text-[0.66rem] text-[color:var(--project-home-muted)]">
          {props.project.path}
        </span>
      </span>
    </button>
  )
}

function ProjectPreviewPanel(props: ProjectPreviewPanelProps): JSX.Element {
  const { t } = useI18n()
  const stats = [
    {
      label: t('common.project.home.preview.file_count'),
      value: props.project.preview.file_count.toLocaleString(),
    },
    {
      label: t('common.project.home.preview.created_at'),
      value: props.project.preview.created_at,
    },
    {
      label: t('common.project.home.preview.updated_at'),
      value: props.project.preview.last_updated_at,
    },
  ]

  return (
    <Card className="project-home__preview-card">
      <CardContent className="space-y-3 px-4 py-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center justify-between gap-5">
            <span className="text-[0.77rem] text-foreground">{stat.label}</span>
            <span className="text-[0.77rem] font-medium text-foreground">{stat.value}</span>
          </div>
        ))}

        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[0.77rem] text-foreground">{t('common.project.home.preview.progress')}</span>
            <span className="text-[0.77rem] font-semibold text-foreground">{props.project.preview.progress_percent}%</span>
          </div>
          <Progress
            value={props.project.preview.progress_percent}
            className="h-1.5 bg-[color:var(--project-home-progress-track)]"
          />
          <div className="flex items-center justify-between gap-4 text-[0.77rem] text-foreground">
            <span>
              {t('common.project.home.preview.translated')} {props.project.preview.translated_items.toLocaleString()}{' '}
              {t('common.project.home.preview.rows_unit')}
            </span>
            <span>
              {t('common.project.home.preview.total')} {props.project.preview.total_items.toLocaleString()}{' '}
              {t('common.project.home.preview.rows_unit')}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProjectPage(props: ProjectPageProps): JSX.Element {
  const { t } = useI18n()
  const [selected_project, set_selected_project] = useState<ProjectRecentProject | null>(null)
  const has_recent_projects = project_page_mock.recent_projects.length > 0

  return (
    <div className="project-home workspace-scroll" data-sidebar-collapsed={String(props.is_sidebar_collapsed)}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="project-home__panel min-h-[696px]">
          <PanelHeader
            accent_class_name="bg-[color:var(--project-home-blue)]"
            title={t('common.project.home.create.title')}
            subtitle={t('common.project.home.create.subtitle')}
          />

          <CardContent className="flex flex-1 flex-col gap-6 px-6 pt-0 pb-0">
            <DropZoneCard icon="source" tone="blue" title={t('common.project.home.create.drop_title')} />

            <section className="space-y-4 pt-4">
              <h3 className="text-[1rem] leading-none font-semibold tracking-[-0.02em] text-foreground">
                {t('common.project.home.formats.title')}
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {project_page_mock.supported_formats.map((format_item) => (
                  <FormatSupportCard
                    key={format_item.id}
                    title={t(format_item.title_key)}
                    extensions={format_item.extensions}
                  />
                ))}
              </div>
            </section>
          </CardContent>

          <CardFooter className="mt-auto justify-center px-6 pt-4 pb-6">
            <Button variant="brand" className="project-home__action min-w-[160px]" disabled>
              {t('common.project.home.create.action')}
            </Button>
          </CardFooter>
        </Card>

        <Card className="project-home__panel min-h-[696px]">
          <PanelHeader
            accent_class_name="bg-[color:var(--project-home-purple)]"
            title={t('common.project.home.open.title')}
            subtitle={t('common.project.home.open.subtitle')}
          />

          <CardContent className="flex flex-1 flex-col gap-6 px-6 pt-0 pb-0">
            {selected_project !== null ? (
              <div className="project-home__selected-card project-home__selected-card--purple relative">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="project-home__selected-close h-[30px] w-[30px] p-0"
                  onClick={() => set_selected_project(null)}
                  aria-label={t('common.action.reset')}
                >
                  <X className="size-4" />
                </Button>

                <div className="project-home__selected-content">
                  <span className="project-home__dropzone-icon">
                    <File className="size-12 stroke-[1.85]" />
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-[0.9rem] font-semibold tracking-[-0.02em] text-foreground">
                      {selected_project.name}.lg
                    </p>
                    <p className="text-[0.76rem] text-[color:var(--project-home-subtitle)]">{t('common.project.home.open.ready_status')}</p>
                  </div>
                </div>
              </div>
            ) : (
              <DropZoneCard icon="project" tone="purple" title={t('common.project.home.open.drop_title')} />
            )}

            <section className="space-y-4 pt-4">
              <h3 className="text-[1rem] leading-none font-semibold tracking-[-0.02em] text-foreground">
                {t('common.project.home.open.recent_title')}
              </h3>

              {selected_project !== null ? (
                <ProjectPreviewPanel project={selected_project} />
              ) : has_recent_projects ? (
                <div className="space-y-1">
                  {project_page_mock.recent_projects.map((project_item) => (
                    <RecentProjectRow
                      key={project_item.id}
                      project={project_item}
                      on_select={(project) => set_selected_project(project)}
                    />
                  ))}
                </div>
              ) : (
                <Empty className="project-home__empty-state">
                  <EmptyHeader>
                    <EmptyMedia>
                      <ShieldAlert className="size-7 stroke-[1.8]" />
                    </EmptyMedia>
                    <EmptyTitle>{t('common.project.home.open.recent_title')}</EmptyTitle>
                    <EmptyDescription>{t('common.project.home.open.empty')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </CardContent>

          <CardFooter className={cn('mt-auto justify-center px-6 pb-6', selected_project === null ? 'pt-4' : 'pt-6')}>
            <Button
              variant="brand"
              className="project-home__action min-w-[160px]"
              disabled={selected_project === null}
            >
              {t('common.project.home.open.action')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
