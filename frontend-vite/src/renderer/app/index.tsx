import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ThemeProvider, useTheme } from 'next-themes'

import { DEFAULT_ROUTE_ID, BOTTOM_ACTIONS, NAVIGATION_GROUPS } from '@/app/navigation/schema'
import { SCREEN_REGISTRY } from '@/app/navigation/screen-registry'
import { AppNavigationProvider } from '@/app/navigation/navigation-context'
import { DesktopRuntimeProvider } from '@/app/state/desktop-runtime-context'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import '@/app/shell/app-shell.css'
import type { BottomActionId, RouteId } from '@/app/navigation/types'
import { LocaleProvider, useI18n } from '@/i18n'
import { SidebarInset, SidebarProvider } from '@/shadcn/sidebar'
import { Toaster } from '@/shadcn/sonner'
import { TooltipProvider } from '@/shadcn/tooltip'
import { AppSidebar } from '@/app/shell/app-sidebar'
import { AppTitlebar } from '@/app/shell/app-titlebar'

const SIDEBAR_STORAGE_KEY = 'lg-sidebar-collapsed'
const THEME_STORAGE_KEY = 'lg-theme-mode'

type ThemeMode = 'light' | 'dark'

const PROJECT_DEPENDENT_ROUTE_IDS: ReadonlySet<RouteId> = new Set([
  'translation',
  'analysis',
  'proofreading',
  'workbench',
  'glossary',
  'text-preserve',
  'text-replacement',
  'pre-translation-replacement',
  'post-translation-replacement',
  'custom-prompt',
  'translation-prompt',
  'analysis-prompt',
  'laboratory',
  'toolbox',
])

const ROUTE_IDS_DISABLED_WHEN_PROJECT_UNLOADED: ReadonlySet<RouteId> = new Set([
  'glossary',
  'text-preserve',
  'text-replacement',
  'pre-translation-replacement',
  'post-translation-replacement',
  'custom-prompt',
  'translation-prompt',
  'analysis-prompt',
  'laboratory',
  'toolbox',
])

const EXPERT_MODE_ROUTE_IDS: ReadonlySet<RouteId> = new Set([
  'expert-settings',
  'text-preserve',
])

function read_sidebar_state(): boolean {
  const stored_sidebar_state = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)

  if (stored_sidebar_state === 'true') {
    return true
  } else {
    return false
  }
}

function read_theme_mode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const stored_theme = window.localStorage.getItem(THEME_STORAGE_KEY)

  if (stored_theme === 'light' || stored_theme === 'dark') {
    return stored_theme
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  } else {
    return 'light'
  }
}

function AppContent(): JSX.Element {
  const {
    hydration_ready,
    pending_target_route,
    project_snapshot,
    settings_snapshot,
    set_pending_target_route,
  } = useDesktopRuntime()
  const { toggle_locale, t } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const shell_info = window.desktopApp.shell
  const [selected_route, set_selected_route] = useState<RouteId>(DEFAULT_ROUTE_ID)
  const [expanded_items, set_expanded_items] = useState<Set<RouteId>>(() => new Set())
  const [is_sidebar_collapsed, set_is_sidebar_collapsed] = useState<boolean>(() => read_sidebar_state())
  const previous_project_loaded_ref = useRef<boolean>(project_snapshot.loaded)
  const previous_project_path_ref = useRef<string>(project_snapshot.path)
  const active_screen = SCREEN_REGISTRY[selected_route]
  const ScreenComponent = active_screen.component
  const document_title = `${t('app.metadata.app_name')} · ${t(active_screen.title_key)}`
  const theme_mode: ThemeMode = resolvedTheme === 'dark'
    ? 'dark'
    : resolvedTheme === 'light'
      ? 'light'
      : read_theme_mode()

  useEffect(() => {
    window.desktopApp.setTitleBarTheme(theme_mode)
  }, [theme_mode])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(is_sidebar_collapsed))
  }, [is_sidebar_collapsed])

  useEffect(() => {
    document.title = document_title
  }, [document_title])

  useEffect(() => {
    if (!hydration_ready) {
      return
    }

    const was_loaded = previous_project_loaded_ref.current
    const previous_project_path = previous_project_path_ref.current
    previous_project_loaded_ref.current = project_snapshot.loaded
    previous_project_path_ref.current = project_snapshot.path

    if (!was_loaded && project_snapshot.loaded) {
      if (pending_target_route !== null) {
        set_selected_route(pending_target_route)
        set_pending_target_route(null)
      } else {
        set_selected_route('workbench')
      }
      return
    }

    if (was_loaded && !project_snapshot.loaded) {
      set_selected_route(DEFAULT_ROUTE_ID)
      set_pending_target_route(null)
      return
    }

    if (
      project_snapshot.loaded
      && project_snapshot.path !== previous_project_path
      && selected_route === DEFAULT_ROUTE_ID
      && pending_target_route === null
    ) {
      set_selected_route('workbench')
    }
  }, [
    hydration_ready,
    pending_target_route,
    project_snapshot.loaded,
    project_snapshot.path,
    selected_route,
    set_pending_target_route,
  ])

  const disabled_route_ids = useMemo<ReadonlySet<RouteId>>(() => {
    if (project_snapshot.loaded) {
      return new Set()
    }

    return new Set(ROUTE_IDS_DISABLED_WHEN_PROJECT_UNLOADED)
  }, [project_snapshot.loaded])

  const visible_navigation_groups = useMemo(() => {
    return NAVIGATION_GROUPS.filter((group) => {
      return group.items.some((item) => SCREEN_REGISTRY[item.id] !== undefined)
    }).map((group) => {
      return {
        ...group,
        items: group.items
          .filter((item) => SCREEN_REGISTRY[item.id] !== undefined)
          .filter((item) => settings_snapshot.expert_mode || !EXPERT_MODE_ROUTE_IDS.has(item.id))
          .map((item) => {
            if ((item.children?.length ?? 0) === 0) {
              return item
            }

            return {
              ...item,
              children: item.children?.filter((child) => {
                return settings_snapshot.expert_mode || !EXPERT_MODE_ROUTE_IDS.has(child.id)
              }),
            }
          }),
      }
    })
  }, [settings_snapshot.expert_mode])

  function handle_select_route(route_id: RouteId): void {
    if (!project_snapshot.loaded && PROJECT_DEPENDENT_ROUTE_IDS.has(route_id)) {
      set_pending_target_route(route_id)
      set_selected_route(DEFAULT_ROUTE_ID)
      return
    }

    if (!PROJECT_DEPENDENT_ROUTE_IDS.has(route_id)) {
      set_pending_target_route(null)
    }

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
      if (theme_mode === 'light') {
        setTheme('dark')
      } else {
        setTheme('light')
      }
    } else if (action_id === 'language') {
      toggle_locale()
    } else {
      set_pending_target_route(null)
      set_selected_route('app-settings')
    }
  }

  return (
    <SidebarProvider
      open={!is_sidebar_collapsed}
      onOpenChange={(is_open) => {
        // 统一由应用根持有折叠态，这样标题栏按钮和 sidebar 语义状态始终一致。
        set_is_sidebar_collapsed(!is_open)
      }}
      style={
        {
          '--sidebar-width': '256px',
          '--sidebar-width-icon': '72px',
        } as CSSProperties
      }
    >
      <main
        className="app-shell"
        style={
          {
            '--titlebar-height': `${shell_info.titleBarHeight}px`,
            '--titlebar-safe-area-start': `${shell_info.titleBarSafeAreaStart}px`,
            '--titlebar-safe-area-end': `${shell_info.titleBarSafeAreaEnd}px`,
          } as CSSProperties
        }
      >
        <AppTitlebar />
        <section className="shell-body">
          <AppSidebar
            groups={visible_navigation_groups}
            bottom_actions={BOTTOM_ACTIONS}
            selected_route={selected_route}
            expanded_items={expanded_items}
            disabled_route_ids={disabled_route_ids}
            on_select_route={handle_select_route}
            on_toggle_group={handle_toggle_group}
            on_bottom_action={handle_bottom_action}
          />

          <SidebarInset className="workspace-frame" aria-label={t(active_screen.title_key)}>
            <AppNavigationProvider
              selected_route={selected_route}
              navigate_to_route={handle_select_route}
            >
              <ScreenComponent is_sidebar_collapsed={is_sidebar_collapsed} />
            </AppNavigationProvider>
          </SidebarInset>
        </section>
      </main>
    </SidebarProvider>
  )
}

function App(): JSX.Element {
  return (
    <LocaleProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme={read_theme_mode()}
        enableSystem={false}
        storageKey={THEME_STORAGE_KEY}
        themes={['light', 'dark']}
      >
        <DesktopRuntimeProvider>
          <TooltipProvider delayDuration={120}>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </DesktopRuntimeProvider>
      </ThemeProvider>
    </LocaleProvider>
  )
}

export default App


