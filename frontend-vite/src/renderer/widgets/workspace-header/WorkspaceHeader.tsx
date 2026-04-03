import { Badge } from '@/components/ui/badge'
import { useI18n, type LocaleKey } from '@/i18n'

type WorkspaceChip = {
  id: string
  label: string
  tone?: 'default' | 'accent'
}

type WorkspaceHeaderProps = {
  eyebrow_key: LocaleKey
  title_key: LocaleKey
  chips: WorkspaceChip[]
}

export function WorkspaceHeader(props: WorkspaceHeaderProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="workspace-header">
      <div>
        <p className="workspace-header__eyebrow">{t(props.eyebrow_key)}</p>
        <h1 className="workspace-header__title">{t(props.title_key)}</h1>
      </div>
      <div className="workspace-header__chips">
        {props.chips.map((chip) => (
          <Badge
            key={chip.id}
            variant={chip.tone === 'accent' ? 'brand' : 'secondary'}
            className={chip.tone === 'accent' ? 'workspace-chip workspace-chip--accent' : 'workspace-chip'}
          >
            {chip.label}
          </Badge>
        ))}
      </div>
    </div>
  )
}
