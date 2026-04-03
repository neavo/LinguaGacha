import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { DEFAULT_ROUTE_ID, BOTTOM_ACTIONS, NAVIGATION_GROUPS } from '@/app/navigation/schema'
import type { BottomActionId, RouteId } from '@/app/navigation/types'
import { SCREEN_REGISTRY } from '@/app/main/ScreenRegistry'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import '@/shared/styles/app-shell.css'
import { AppSidebar } from '@/widgets/app-sidebar/AppSidebar'
import { AppTitlebar } from '@/widgets/app-titlebar/AppTitlebar'

const SIDEBAR_STORAGE_KEY = 'lg-sidebar-collapsed'
const THEME_STORAGE_KEY = 'lg-theme-mode'

type ThemeMode = 'light' | 'dark'

function read_sidebar_state(): boolean {
  const stored_sidebar_state = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)

  if (stored_sidebar_state === 'true') {
    return true
  } else {
    return false
  }
}

function read_theme_mode(): ThemeMode {
  const stored_theme = window.localStorage.getItem(THEME_STORAGE_KEY)

  if (stored_theme === 'light' || stored_theme === 'dark') {
    return stored_theme
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  } else {
    return 'light'
  }
}

export function AppShell(): JSX.Element {
  const { toggle_locale, t } = useI18n()
  const [selected_route, set_selected_route] = useState<RouteId>(DEFAULT_ROUTE_ID)
  const [expanded_items, set_expanded_items] = useState<Set<RouteId>>(() => new Set())
  const [is_sidebar_collapsed, set_is_sidebar_collapsed] = useState<boolean>(() => read_sidebar_state())
  const [theme_mode, set_theme_mode] = useState<ThemeMode>(() => read_theme_mode())
  const active_screen = SCREEN_REGISTRY[selected_route]
  const ScreenComponent = active_screen.component
  const document_title = `${t('common.metadata.app_name')} · ${t(active_screen.title_key)}`

  useEffect(() => {
    const root_element = document.documentElement
    root_element.classList.toggle('dark', theme_mode === 'dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, theme_mode)
    window.desktopApp.setTitleBarTheme(theme_mode)
  }, [theme_mode])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(is_sidebar_collapsed))
  }, [is_sidebar_collapsed])

  useEffect(() => {
    document.title = document_title
  }, [document_title])

  const visible_navigation_groups = useMemo(() => {
    return NAVIGATION_GROUPS.filter((group) => {
      return group.items.some((item) => SCREEN_REGISTRY[item.id] !== undefined)
    }).map((group) => {
      return {
        ...group,
        items: group.items.filter((item) => SCREEN_REGISTRY[item.id] !== undefined),
      }
    })
  }, [])

  function handle_select_route(route_id: RouteId): void {
    set_selected_route(route_id)
  }

  function handle_toggle_group(route_id: RouteId): void {
    if (is_sidebar_collapsed) {
      set_is_sidebar_collapsed(false)
      set_expanded_items((previous_items) => {
        const next_items = new Set(previous_items)
        next_items.add(route_id)
        return next_items
      })
    } else {
      set_expanded_items((previous_items) => {
        const next_items = new Set(previous_items)

        if (next_items.has(route_id)) {
          next_items.delete(route_id)
        } else {
          next_items.add(route_id)
        }

        return next_items
      })
    }
  }

  function handle_bottom_action(action_id: BottomActionId): void {
    if (action_id === 'theme') {
      set_theme_mode((previous_mode) => {
        if (previous_mode === 'light') {
          return 'dark'
        } else {
          return 'light'
        }
      })
    } else if (action_id === 'language') {
      toggle_locale()
    } else {
      set_selected_route('app-settings')
    }
  }

  return (
    <SidebarProvider
      open={!is_sidebar_collapsed}
      onOpenChange={(is_open) => {
        // 统一由壳层持有折叠态，这样标题栏按钮和 sidebar 语义状态始终一致。
        set_is_sidebar_collapsed(!is_open)
      }}
      style={
        {
          '--sidebar-width': '16rem',
          '--sidebar-width-icon': '4.5rem',
        } as CSSProperties
      }
    >
      <main className={cn('app-shell', is_sidebar_collapsed && 'app-shell--sidebar-collapsed')}>
        <AppTitlebar />
        <section className="shell-body">
          <AppSidebar
            groups={visible_navigation_groups}
            bottom_actions={BOTTOM_ACTIONS}
            selected_route={selected_route}
            expanded_items={expanded_items}
            is_collapsed={is_sidebar_collapsed}
            on_select_route={handle_select_route}
            on_toggle_group={handle_toggle_group}
            on_bottom_action={handle_bottom_action}
          />

          <SidebarInset className="workspace-frame" aria-label={t(active_screen.title_key)}>
            <ScreenComponent is_sidebar_collapsed={is_sidebar_collapsed} />
          </SidebarInset>
        </section>
      </main>
    </SidebarProvider>
  )
}
