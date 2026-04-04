import { Clock3, Play, RotateCcw, Square, type LucideIcon } from 'lucide-react'

import { ActionBar, ActionBarSeparator } from '@/components/ui/action-bar'
import { Button } from '@/components/ui/button'
import { useI18n, type LocaleKey } from '@/i18n'

type WorkspaceCommandBarProps = {
  hint_key: LocaleKey
}

type WorkspaceAction = {
  id: 'start' | 'stop' | 'reset' | 'timer'
  icon: LucideIcon
  label_key: LocaleKey
}

export function WorkspaceCommandBar(props: WorkspaceCommandBarProps): JSX.Element {
  const { t } = useI18n()
  const actions: WorkspaceAction[] = [
    { id: 'start', icon: Play, label_key: 'common.action.start' },
    { id: 'stop', icon: Square, label_key: 'common.action.stop' },
    { id: 'reset', icon: RotateCcw, label_key: 'common.action.reset' },
    { id: 'timer', icon: Clock3, label_key: 'common.action.timer' },
  ]

  return (
    <ActionBar
      hint={t(props.hint_key)}
      actions={
        <>
          {actions.map((action, index) => {
            const Icon = action.icon

            return (
              <div key={action.id} className="contents">
                {index > 0 ? <ActionBarSeparator className="hidden md:block" /> : null}
                <Button variant="ghost" size="toolbar">
                  <Icon data-icon="inline-start" />
                  {t(action.label_key)}
                </Button>
              </div>
            )
          })}
        </>
      }
    />
  )
}
