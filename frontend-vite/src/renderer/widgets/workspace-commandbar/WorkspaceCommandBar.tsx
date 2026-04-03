import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useI18n, type LocaleKey } from '@/i18n'

type WorkspaceCommandBarProps = {
  hint_key: LocaleKey
}

export function WorkspaceCommandBar(props: WorkspaceCommandBarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="workspace-commandbar">
      <div className="workspace-commandbar__content">
        <div className="workspace-commandbar__group">
          <Button variant="brand">{t('common.action.start')}</Button>
          <Button variant="outline">{t('common.action.stop')}</Button>
          <Button variant="outline">{t('common.action.reset')}</Button>
          <Separator orientation="vertical" className="workspace-commandbar__separator hidden md:block" />
          <Button variant="ghost">{t('common.action.timer')}</Button>
        </div>
        <span className="workspace-commandbar__hint">{t(props.hint_key)}</span>
      </div>
    </div>
  )
}
