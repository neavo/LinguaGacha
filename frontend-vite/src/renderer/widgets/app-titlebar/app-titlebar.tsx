import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { startTransition } from 'react'

import { useSidebar } from '@/ui/sidebar'
import { useI18n } from '@/i18n'

export function AppTitlebar(): JSX.Element {
  const { t } = useI18n()
  const { state, toggleSidebar } = useSidebar()
  const SidebarToggleIcon = state === 'expanded' ? PanelLeftClose : PanelLeftOpen

  return (
    <header className="titlebar shell-topbar">
      <div className="topbar__left">
        <button
          className="topbar__menu-button"
          aria-label={t('common.aria.toggle_navigation')}
          onClick={() => {
            startTransition(() => {
              toggleSidebar()
            })
          }}
        >
          <SidebarToggleIcon size={18} />
        </button>
        <div className="topbar__brand">
          <strong>LinguaGacha v0.60.1</strong>
        </div>
      </div>
      <div className="topbar__right" />
    </header>
  )
}
