import { startTransition, useEffect, useState } from 'react'
import {
  BetweenVerticalEnd,
  BetweenVerticalStart,
  BookA,
  BookOpenCheck,
  Boxes,
  ChevronDown,
  FlaskConical,
  GraduationCap,
  Grid2x2Check,
  Languages,
  LayoutDashboard,
  Menu,
  Radar,
  ReplaceAll,
  ScanText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n, type LocaleKey } from '@/i18n'
import { cn } from '@/lib/utils'
import './app.css'

type NavigationEntry = {
  id: string
  label_key: LocaleKey
  summary_key: LocaleKey
  icon: LucideIcon
  children?: NavigationEntry[]
}

type NavigationGroup = {
  id: string
  items: NavigationEntry[]
}

type BottomAction = {
  id: 'theme' | 'language' | 'app-settings'
  label_key: LocaleKey
  icon: LucideIcon
}

type ActivePageCopy = {
  title_key: LocaleKey
  summary_key: LocaleKey
}

const FALLBACK_ACTIVE_PAGE_COPY: ActivePageCopy = {
  title_key: 'common.workspace.default_title',
  summary_key: 'common.workspace.commandbar_hint',
}

const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: 'project',
    items: [
      {
        id: 'model',
        label_key: 'nav.item.model',
        summary_key: 'common.project.model.summary',
        icon: Boxes,
      },
    ],
  },
  {
    id: 'task',
    items: [
      {
        id: 'translation',
        label_key: 'nav.item.translation',
        summary_key: 'task.page.translation.summary',
        icon: ScanText,
      },
      {
        id: 'analysis',
        label_key: 'nav.item.analysis',
        summary_key: 'task.page.analysis.summary',
        icon: Radar,
      },
      {
        id: 'proofreading',
        label_key: 'nav.item.proofreading',
        summary_key: 'task.page.proofreading.summary',
        icon: Grid2x2Check,
      },
      {
        id: 'workbench',
        label_key: 'nav.item.workbench',
        summary_key: 'task.page.workbench.summary',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    id: 'setting',
    items: [
      {
        id: 'basic-settings',
        label_key: 'nav.item.basic_settings',
        summary_key: 'setting.page.basic.summary',
        icon: SlidersHorizontal,
      },
      {
        id: 'expert-settings',
        label_key: 'nav.item.expert_settings',
        summary_key: 'setting.page.expert.summary',
        icon: GraduationCap,
      },
    ],
  },
  {
    id: 'quality',
    items: [
      {
        id: 'glossary',
        label_key: 'nav.item.glossary',
        summary_key: 'quality.page.glossary.summary',
        icon: BookA,
      },
      {
        id: 'text-preserve',
        label_key: 'nav.item.text_preserve',
        summary_key: 'quality.page.text_preserve.summary',
        icon: ShieldCheck,
      },
      {
        id: 'text-replacement',
        label_key: 'nav.item.text_replacement',
        summary_key: 'quality.page.text_replacement.summary',
        icon: ReplaceAll,
        children: [
          {
            id: 'pre-translation-replacement',
            label_key: 'nav.item.pre_translation_replacement',
            summary_key: 'quality.page.pre_translation_replacement.summary',
            icon: BetweenVerticalStart,
          },
          {
            id: 'post-translation-replacement',
            label_key: 'nav.item.post_translation_replacement',
            summary_key: 'quality.page.post_translation_replacement.summary',
            icon: BetweenVerticalEnd,
          },
        ],
      },
      {
        id: 'custom-prompt',
        label_key: 'nav.item.custom_prompt',
        summary_key: 'quality.page.custom_prompt.summary',
        icon: BookOpenCheck,
        children: [
          {
            id: 'translation-prompt',
            label_key: 'nav.item.translation_prompt',
            summary_key: 'quality.page.translation_prompt.summary',
            icon: ScanText,
          },
          {
            id: 'analysis-prompt',
            label_key: 'nav.item.analysis_prompt',
            summary_key: 'quality.page.analysis_prompt.summary',
            icon: Radar,
          },
        ],
      },
    ],
  },
  {
    id: 'extra',
    items: [
      {
        id: 'laboratory',
        label_key: 'nav.item.laboratory',
        summary_key: 'extra.page.laboratory.summary',
        icon: FlaskConical,
      },
      {
        id: 'toolbox',
        label_key: 'nav.item.toolbox',
        summary_key: 'extra.page.toolbox.summary',
        icon: Sparkles,
      },
    ],
  },
]

const BOTTOM_ACTIONS: BottomAction[] = [
  { id: 'theme', label_key: 'nav.action.theme', icon: SunMoon },
  { id: 'language', label_key: 'nav.action.language', icon: Languages },
  { id: 'app-settings', label_key: 'nav.action.app_settings', icon: Settings },
]

function collect_navigation_copy(
  navigation_entries: NavigationEntry[],
  navigation_copy_map: Map<string, ActivePageCopy>,
): void {
  for (const navigation_entry of navigation_entries) {
    navigation_copy_map.set(navigation_entry.id, {
      title_key: navigation_entry.label_key,
      summary_key: navigation_entry.summary_key,
    })

    if (navigation_entry.children !== undefined) {
      collect_navigation_copy(navigation_entry.children, navigation_copy_map)
    }
  }
}

// 导航配置只保存 key 和结构，并在模块初始化时预计算查找表，避免渲染时重复遍历。
function build_navigation_copy_map(navigation_groups: NavigationGroup[]): Map<string, ActivePageCopy> {
  const navigation_copy_map: Map<string, ActivePageCopy> = new Map()

  for (const navigation_group of navigation_groups) {
    collect_navigation_copy(navigation_group.items, navigation_copy_map)
  }

  return navigation_copy_map
}

const NAVIGATION_COPY_MAP: ReadonlyMap<string, ActivePageCopy> = build_navigation_copy_map(NAVIGATION_GROUPS)

function App(): JSX.Element {
  // 侧边栏启动时默认回到工作台，并保持二级菜单收起，避免初始视觉过载。
  const [selected_route, set_selected_route] = useState<string>('workbench')
  const [expanded_items, set_expanded_items] = useState<Set<string>>(() => new Set())
  const { toggle_locale, t } = useI18n()
  const [is_sidebar_collapsed, set_is_sidebar_collapsed] = useState<boolean>(() => {
    const stored_sidebar_state = window.localStorage.getItem('lg-sidebar-collapsed')
    if (stored_sidebar_state === 'true') {
      return true
    } else {
      return false
    }
  })
  const [theme_mode, set_theme_mode] = useState<'light' | 'dark'>(() => {
    const stored_theme = window.localStorage.getItem('lg-theme-mode')
    if (stored_theme === 'light' || stored_theme === 'dark') {
      return stored_theme
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const active_page_copy = NAVIGATION_COPY_MAP.get(selected_route) ?? FALLBACK_ACTIVE_PAGE_COPY
  const active_page_title = t(active_page_copy.title_key)
  const active_page_summary = t(active_page_copy.summary_key)
  const document_title = `${t('common.metadata.app_name')} · ${active_page_title}`

  useEffect(() => {
    const root_element = document.documentElement
    root_element.classList.toggle('dark', theme_mode === 'dark')
    window.localStorage.setItem('lg-theme-mode', theme_mode)
    window.desktopApp.setTitleBarTheme(theme_mode)
  }, [theme_mode])

  useEffect(() => {
    window.localStorage.setItem('lg-sidebar-collapsed', String(is_sidebar_collapsed))
  }, [is_sidebar_collapsed])

  useEffect(() => {
    document.title = document_title
  }, [document_title])

  return (
    <main className={cn('app-shell', is_sidebar_collapsed && 'app-shell--sidebar-collapsed')}>
      <header className="titlebar shell-topbar">
        <div className="topbar__left">
          <button
            className="topbar__menu-button"
            aria-label={t('common.aria.toggle_navigation')}
            aria-expanded={!is_sidebar_collapsed}
            onClick={() => {
              startTransition(() => {
                set_is_sidebar_collapsed((previous_state) => !previous_state)
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

      <section className="shell-body">
        <aside className="shell-sidebar">
          <div className="shell-sidebar__scroll">
            {NAVIGATION_GROUPS.map((group, group_index) => (
              <section key={group.id} className={cn('sidebar-group', group_index > 0 && 'sidebar-group--separated')}>
                <div className="sidebar-group__items">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const has_children = (item.children?.length ?? 0) > 0
                    const has_active_child = item.children?.some((child) => child.id === selected_route) ?? false
                    const is_active = selected_route === item.id
                    const is_expanded = has_children && expanded_items.has(item.id)
                    const is_subitems_open = !is_sidebar_collapsed && is_expanded

                    return (
                      <div key={item.id} className="sidebar-entry">
                        <button
                          className={cn(
                            'sidebar-item',
                            is_active && 'sidebar-item--active',
                            has_active_child && 'sidebar-item--parent-active'
                          )}
                          onClick={() => {
                            startTransition(() => {
                              if (has_children) {
                                if (is_sidebar_collapsed) {
                                  set_is_sidebar_collapsed(false)
                                  set_expanded_items((previous_items) => {
                                    const next_items = new Set(previous_items)
                                    next_items.add(item.id)
                                    return next_items
                                  })
                                } else {
                                  set_expanded_items((previous_items) => {
                                    const next_items = new Set(previous_items)
                                    if (next_items.has(item.id)) {
                                      next_items.delete(item.id)
                                    } else {
                                      next_items.add(item.id)
                                    }
                                    return next_items
                                  })
                                }
                                set_selected_route(item.id)
                              } else {
                                set_selected_route(item.id)
                              }
                            })
                          }}
                          aria-label={t(item.label_key)}
                        >
                          <span className="sidebar-item__rail" />
                          <Icon size={18} className="sidebar-item__icon" />
                          <span className="sidebar-item__label">{t(item.label_key)}</span>
                          {has_children ? (
                            <ChevronDown
                              size={15}
                              className={cn('sidebar-item__chevron', is_expanded && 'sidebar-item__chevron--expanded')}
                            />
                          ) : null}
                        </button>
                        {has_children ? (
                          <div
                            className={cn(
                              'sidebar-subitems-shell',
                              is_subitems_open && 'sidebar-subitems-shell--expanded'
                            )}
                            aria-hidden={!is_subitems_open}
                          >
                            <div className="sidebar-subitems">
                              {item.children?.map((child) => {
                                const ChildIcon = child.icon
                                const is_child_active = child.id === selected_route

                                return (
                                  <button
                                    key={child.id}
                                    className={cn('sidebar-subitem', is_child_active && 'sidebar-subitem--active')}
                                    onClick={() => {
                                      startTransition(() => {
                                        set_selected_route(child.id)
                                      })
                                    }}
                                    aria-label={t(child.label_key)}
                                    tabIndex={is_subitems_open ? 0 : -1}
                                  >
                                    <span className="sidebar-subitem__rail" />
                                    <ChildIcon size={16} className="sidebar-subitem__icon" />
                                    <span className="sidebar-subitem__label">{t(child.label_key)}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="shell-sidebar__bottom">
            <div className="sidebar-bottom-actions">
              {BOTTOM_ACTIONS.map((action) => {
                const ActionIcon = action.icon

                return (
                  <button
                    key={action.id}
                    className="sidebar-bottom-button"
                    aria-label={t(action.label_key)}
                    onClick={() => {
                      if (action.id === 'theme') {
                        startTransition(() => {
                          set_theme_mode((previous_mode) => (previous_mode === 'light' ? 'dark' : 'light'))
                        })
                      } else if (action.id === 'language') {
                        startTransition(() => {
                          toggle_locale()
                        })
                      }
                    }}
                  >
                    <ActionIcon size={16} />
                    <span className="sidebar-bottom-button__text">{t(action.label_key)}</span>
                  </button>
                )
              })}
            </div>

            <button className="sidebar-profile">
              <span className="sidebar-profile__avatar">
                <img className="sidebar-profile__avatar-image" src="/icon.png" alt="LinguaGacha" />
              </span>
              <span className="sidebar-profile__text">{t('common.profile.status')}</span>
            </button>
          </div>
        </aside>

        <section className="workspace-frame">
          <div className="workspace-scroll">
            <div className="workspace-header">
              <div>
                <p className="workspace-header__eyebrow">{t('common.workspace.preview_eyebrow')}</p>
                <h1 className="workspace-header__title">{active_page_title}</h1>
              </div>
              <div className="workspace-header__chips">
                <span className="workspace-chip">
                  {is_sidebar_collapsed
                    ? t('common.workspace.sidebar_width_collapsed')
                    : t('common.workspace.sidebar_width_expanded')}
                </span>
                <span className="workspace-chip workspace-chip--accent">{t('common.workspace.placeholder_chip')}</span>
              </div>
            </div>

            <Card className="workspace-placeholder">
              <CardHeader className="workspace-placeholder__header">
                <CardTitle className="workspace-placeholder__title">{t('common.workspace.content_title')}</CardTitle>
                <CardDescription className="workspace-placeholder__description">{active_page_summary}</CardDescription>
              </CardHeader>
              <CardContent className="workspace-placeholder__content">
                <div className="placeholder-hero">
                  <div className="placeholder-hero__ring" />
                  <div className="placeholder-hero__lines">
                    <span className="placeholder-line placeholder-line--wide" />
                    <span className="placeholder-line placeholder-line--medium" />
                    <span className="placeholder-line placeholder-line--thin" />
                  </div>
                </div>
                <div className="placeholder-grid">
                  <div className="placeholder-card" />
                  <div className="placeholder-card" />
                  <div className="placeholder-card" />
                  <div className="placeholder-card" />
                </div>
              </CardContent>
            </Card>

            <Card className="workspace-commandbar">
              <CardContent className="workspace-commandbar__content">
                <div className="workspace-commandbar__group">
                  <Button>{t('common.action.start')}</Button>
                  <Button variant="outline">
                    {t('common.action.stop')}
                  </Button>
                  <Button variant="outline">
                    {t('common.action.reset')}
                  </Button>
                  <Button variant="ghost">
                    {t('common.action.timer')}
                  </Button>
                </div>
                <span className="workspace-commandbar__hint">{t('common.workspace.commandbar_hint')}</span>
              </CardContent>
            </Card>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
