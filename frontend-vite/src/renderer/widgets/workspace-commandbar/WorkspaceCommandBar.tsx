import { useI18n, type LocaleKey } from '@/i18n'
import { Button } from '@/shared/ui/button'

type WorkspaceCommandBarProps = {
  hint_key: LocaleKey
}

export function WorkspaceCommandBar(props: WorkspaceCommandBarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="workspace-commandbar">
      <div className="workspace-commandbar__content">
        <div className="workspace-commandbar__group">
          <Button>{t('common.action.start')}</Button>
          <Button variant="outline">{t('common.action.stop')}</Button>
          <Button variant="outline">{t('common.action.reset')}</Button>
          <Button variant="ghost">{t('common.action.timer')}</Button>
        </div>
        <span className="workspace-commandbar__hint">{t(props.hint_key)}</span>
      </div>
    </div>
  )
}
