import { Menu } from 'lucide-react'
import { startTransition } from 'react'

import { useI18n } from '@/i18n'

type AppTitlebarProps = {
  on_toggle_sidebar: () => void
}

export function AppTitlebar(props: AppTitlebarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <header className="titlebar shell-topbar">
      <div className="topbar__left">
        <button
          className="topbar__menu-button"
          aria-label={t('common.aria.toggle_navigation')}
          onClick={() => {
            startTransition(() => {
              props.on_toggle_sidebar()
            })
          }}
        >
          <Menu size={20} />
        </button>
        <div className="topbar__brand">
          <strong>LinguaGacha v0.60.1</strong>
        </div>
      </div>
      <div className="topbar__right" />
    </header>
  )
}
