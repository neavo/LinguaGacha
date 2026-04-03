import { useI18n, type LocaleKey } from '@/i18n'
import type { PageScaffoldMock } from '@/shared/mocks/pageScaffold'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { WorkspaceCommandBar } from '@/widgets/workspace-commandbar/WorkspaceCommandBar'
import { WorkspaceHeader } from '@/widgets/workspace-header/WorkspaceHeader'

export type PageScaffoldProps = {
  title_key: LocaleKey
  summary_key: LocaleKey
  mock: PageScaffoldMock
  is_sidebar_collapsed: boolean
}

export function PageScaffold(props: PageScaffoldProps): JSX.Element {
  const { t } = useI18n()
  const chips = [
    {
      id: 'sidebar-width',
      label: props.is_sidebar_collapsed
        ? t('common.workspace.sidebar_width_collapsed')
        : t('common.workspace.sidebar_width_expanded'),
    },
    {
      id: 'placeholder',
      label: t('common.workspace.placeholder_chip'),
      tone: 'accent' as const,
    },
  ]

  return (
    <div className="workspace-scroll">
      <WorkspaceHeader eyebrow_key="common.workspace.preview_eyebrow" title_key={props.title_key} chips={chips} />

      <Card className="workspace-placeholder">
        <CardHeader className="workspace-placeholder__header">
          <CardTitle className="workspace-placeholder__title">{t('common.workspace.content_title')}</CardTitle>
          <CardDescription className="workspace-placeholder__description">{t(props.summary_key)}</CardDescription>
        </CardHeader>
        <CardContent className="workspace-placeholder__content">
          <div className="placeholder-hero">
            <div className="placeholder-hero__ring" />
            <div className="placeholder-hero__lines">
              {props.mock.hero_line_widths.map((line_width, line_index) => (
                <span
                  key={`${line_width}-${line_index}`}
                  className={`placeholder-line placeholder-line--${line_width}`}
                />
              ))}
            </div>
          </div>
          <div className="placeholder-grid">
            {props.mock.cards.map((card) => (
              <div
                key={card.id}
                className={card.tone === 'accent' ? 'placeholder-card placeholder-card--accent' : 'placeholder-card'}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="workspace-commandbar-card">
        <CardContent className="workspace-commandbar-card__content">
          <WorkspaceCommandBar hint_key="common.workspace.commandbar_hint" />
        </CardContent>
      </Card>
    </div>
  )
}
