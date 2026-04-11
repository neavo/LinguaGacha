import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { startTransition } from 'react'

import { useSidebar } from '@/shadcn/sidebar'
import { useI18n } from '@/i18n'
import '@/app/shell/app-titlebar.css'

export function AppTitlebar(): JSX.Element {
  const { t } = useI18n()
  const { state, toggleSidebar } = useSidebar()
  // 标题栏安全区统一来自 preload 暴露的桌面壳层信息，避免渲染层再猜平台细节。
  const shell_info = window.desktopApp.shell
  const SidebarToggleIcon = state === 'expanded' ? PanelLeftClose : PanelLeftOpen

  return (
    <header
      className="titlebar shell-topbar"
      data-titlebar-control-side={shell_info.titleBarControlSide}
    >
      <div className="topbar__safe-area topbar__safe-area--start" aria-hidden="true" />
      <div className="topbar__content">
        <div className="topbar__left">
          <button
            className="topbar__menu-button"
            aria-label={t('app.aria.toggle_navigation')}
            onClick={() => {
              startTransition(() => {
                toggleSidebar()
              })
            }}
          >
            <SidebarToggleIcon size={18} />
          </button>
          <div className="topbar__brand">
            <strong data-ui-text="emphasis">LinguaGacha v0.60.1</strong>
          </div>
        </div>
      </div>
      <div className="topbar__safe-area topbar__safe-area--end" aria-hidden="true" />
    </header>
  )
}

