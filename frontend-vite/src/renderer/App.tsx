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
import { cn } from '@/lib/utils'
import './App.css'

type NavigationItem = {
  id: string
  label: string
  icon: LucideIcon
  children?: NavigationChild[]
}

type NavigationChild = {
  id: string
  label: string
  icon: LucideIcon
}

type NavigationGroup = {
  id: string
  label: string
  items: NavigationItem[]
}

const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: 'project',
    label: '项目',
    items: [
      { id: 'model', label: '模型管理', icon: Boxes },
    ],
  },
  {
    id: 'task',
    label: '任务',
    items: [
      { id: 'translation', label: '翻译', icon: ScanText },
      { id: 'analysis', label: '分析', icon: Radar },
      { id: 'proofreading', label: '校对', icon: Grid2x2Check },
      { id: 'workbench', label: '工作台', icon: LayoutDashboard },
    ],
  },
  {
    id: 'setting',
    label: '设置',
    items: [
      { id: 'basic-settings', label: '基础设置', icon: SlidersHorizontal },
      { id: 'expert-settings', label: '专家设置', icon: GraduationCap },
    ],
  },
  {
    id: 'quality',
    label: '质量',
    items: [
      { id: 'glossary', label: '术语表', icon: BookA },
      { id: 'text-preserve', label: '文本保护', icon: ShieldCheck },
      {
        id: 'text-replacement',
        label: '文本替换',
        icon: ReplaceAll,
        children: [
          { id: 'pre-translation-replacement', label: '译前替换', icon: BetweenVerticalStart },
          { id: 'post-translation-replacement', label: '译后替换', icon: BetweenVerticalEnd },
        ],
      },
      {
        id: 'custom-prompt',
        label: '自定义提示词',
        icon: BookOpenCheck,
        children: [
          { id: 'translation-prompt', label: '翻译提示词', icon: ScanText },
          { id: 'analysis-prompt', label: '分析提示词', icon: Radar },
        ],
      },
    ],
  },
  {
    id: 'extra',
    label: '扩展',
    items: [
      { id: 'laboratory', label: '实验室', icon: FlaskConical },
      { id: 'toolbox', label: '百宝箱', icon: Sparkles },
    ],
  },
]

const BOTTOM_ACTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'theme', label: '变换自如', icon: SunMoon },
  { id: 'language', label: '字字珠玑', icon: Languages },
  { id: 'app-settings', label: '应用设置', icon: Settings },
]

function find_navigation_label(target_id: string): string {
  for (const group of NAVIGATION_GROUPS) {
    for (const item of group.items) {
      if (item.id === target_id) {
        return item.label
      }
      for (const child of item.children ?? []) {
        if (child.id === target_id) {
          return child.label
        }
      }
    }
  }

  return '工作区'
}

function App(): JSX.Element {
  // 侧边栏启动时默认回到工作台，并保持二级菜单收起，避免初始视觉过载。
  const [selected_route, set_selected_route] = useState<string>('workbench')
  const [expanded_items, set_expanded_items] = useState<Set<string>>(() => new Set())
  const [theme_mode, set_theme_mode] = useState<'light' | 'dark'>(() => {
    const stored_theme = window.localStorage.getItem('lg-theme-mode')
    if (stored_theme === 'light' || stored_theme === 'dark') {
      return stored_theme
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const active_page_title = find_navigation_label(selected_route)

  useEffect(() => {
    const root_element = document.documentElement
    root_element.classList.toggle('dark', theme_mode === 'dark')
    window.localStorage.setItem('lg-theme-mode', theme_mode)
  }, [theme_mode])

  return (
    <main className="app-shell">
      <header className="titlebar shell-topbar">
        <div className="topbar__left">
          <button className="topbar__menu-button" aria-label="打开导航">
            <Menu size={15} />
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
                                set_expanded_items((previous_items) => {
                                  const next_items = new Set(previous_items)
                                  if (next_items.has(item.id)) {
                                    next_items.delete(item.id)
                                  } else {
                                    next_items.add(item.id)
                                  }
                                  return next_items
                                })
                                set_selected_route(item.id)
                              } else {
                                set_selected_route(item.id)
                              }
                            })
                          }}
                        >
                          <span className="sidebar-item__rail" />
                          <Icon size={16} className="sidebar-item__icon" />
                          <span className="sidebar-item__label">{item.label}</span>
                          {has_children ? (
                            <ChevronDown
                              size={13}
                              className={cn('sidebar-item__chevron', is_expanded && 'sidebar-item__chevron--expanded')}
                            />
                          ) : null}
                        </button>
                        {is_expanded ? (
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
                                >
                                  <span className="sidebar-subitem__rail" />
                                  <ChildIcon size={15} className="sidebar-subitem__icon" />
                                  <span className="sidebar-subitem__label">{child.label}</span>
                                </button>
                              )
                            })}
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
                    onClick={() => {
                      if (action.id === 'theme') {
                        startTransition(() => {
                          set_theme_mode((previous_mode) => (previous_mode === 'light' ? 'dark' : 'light'))
                        })
                      }
                    }}
                  >
                    <ActionIcon size={14} />
                    <span>{action.label}</span>
                  </button>
                )
              })}
            </div>

            <button className="sidebar-profile">
              <span className="sidebar-profile__avatar">
                <img className="sidebar-profile__avatar-image" src="/resource/icon.png" alt="LinguaGacha" />
              </span>
              <span className="sidebar-profile__text">Ciallo～(∠・ω&lt; )⌒✮</span>
            </button>
          </div>
        </aside>

        <section className="workspace-frame">
          <div className="workspace-scroll">
            <div className="workspace-header">
              <div>
                <p className="workspace-header__eyebrow">桌面骨架预览</p>
                <h1 className="workspace-header__title">{active_page_title}</h1>
              </div>
              <div className="workspace-header__chips">
                <span className="workspace-chip">导航宽度 256px</span>
                <span className="workspace-chip workspace-chip--accent">右侧内容暂为占位</span>
              </div>
            </div>

            <Card className="workspace-placeholder">
              <CardHeader className="workspace-placeholder__header">
                <CardTitle className="workspace-placeholder__title">内容工作区</CardTitle>
                <CardDescription className="workspace-placeholder__description">
                  这一块先只保留结构和节奏，下一步再把具体页面内容逐步接进来。
                </CardDescription>
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
                  <Button size="sm">开始</Button>
                  <Button size="sm" variant="outline">
                    停止
                  </Button>
                  <Button size="sm" variant="outline">
                    重置
                  </Button>
                  <Button size="sm" variant="ghost">
                    定时器
                  </Button>
                </div>
                <span className="workspace-commandbar__hint">这里后面会挂真实命令栏与状态反馈</span>
              </CardContent>
            </Card>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
