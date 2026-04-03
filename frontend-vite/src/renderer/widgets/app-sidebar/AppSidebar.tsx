import { ChevronDown } from 'lucide-react'
import { startTransition } from 'react'

import type { BottomAction, BottomActionId, NavigationGroup, RouteId } from '@/app/navigation/types'
import { useI18n } from '@/i18n'
import { cn } from '@/shared/lib/utils'

type AppSidebarProps = {
  groups: NavigationGroup[]
  bottom_actions: BottomAction[]
  selected_route: RouteId
  expanded_items: ReadonlySet<RouteId>
  is_collapsed: boolean
  on_select_route: (route_id: RouteId) => void
  on_toggle_group: (route_id: RouteId) => void
  on_bottom_action: (action_id: BottomActionId) => void
}

export function AppSidebar(props: AppSidebarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <aside className="shell-sidebar">
      <div className="shell-sidebar__scroll">
        {props.groups.map((group, group_index) => (
          <section key={group.id} className={cn('sidebar-group', group_index > 0 && 'sidebar-group--separated')}>
            <div className="sidebar-group__items">
              {group.items.map((item) => {
                const Icon = item.icon
                const has_children = (item.children?.length ?? 0) > 0
                const has_active_child = item.children?.some((child) => child.id === props.selected_route) ?? false
                const is_active = props.selected_route === item.id
                const is_expanded = has_children && props.expanded_items.has(item.id)
                const is_subitems_open = !props.is_collapsed && is_expanded

                return (
                  <div key={item.id} className="sidebar-entry">
                    <button
                      className={cn(
                        'sidebar-item',
                        is_active && 'sidebar-item--active',
                        has_active_child && 'sidebar-item--parent-active',
                      )}
                      onClick={() => {
                        startTransition(() => {
                          if (has_children) {
                            props.on_toggle_group(item.id)
                            props.on_select_route(item.id)
                          } else {
                            props.on_select_route(item.id)
                          }
                        })
                      }}
                      aria-label={t(item.title_key)}
                    >
                      <span className="sidebar-item__rail" />
                      <Icon size={18} className="sidebar-item__icon" />
                      <span className="sidebar-item__label">{t(item.title_key)}</span>
                      {has_children ? (
                        <ChevronDown
                          size={15}
                          className={cn('sidebar-item__chevron', is_expanded && 'sidebar-item__chevron--expanded')}
                        />
                      ) : null}
                    </button>
                    {has_children ? (
                      <div
                        className={cn('sidebar-subitems-shell', is_subitems_open && 'sidebar-subitems-shell--expanded')}
                        aria-hidden={!is_subitems_open}
                      >
                        <div className="sidebar-subitems">
                          {item.children?.map((child) => {
                            const ChildIcon = child.icon
                            const is_child_active = child.id === props.selected_route

                            return (
                              <button
                                key={child.id}
                                className={cn('sidebar-subitem', is_child_active && 'sidebar-subitem--active')}
                                onClick={() => {
                                  startTransition(() => {
                                    props.on_select_route(child.id)
                                  })
                                }}
                                aria-label={t(child.title_key)}
                                tabIndex={is_subitems_open ? 0 : -1}
                              >
                                <span className="sidebar-subitem__rail" />
                                <ChildIcon size={16} className="sidebar-subitem__icon" />
                                <span className="sidebar-subitem__label">{t(child.title_key)}</span>
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
          {props.bottom_actions.map((action) => {
            const ActionIcon = action.icon

            return (
              <button
                key={action.id}
                className="sidebar-bottom-button"
                aria-label={t(action.label_key)}
                onClick={() => {
                  startTransition(() => {
                    props.on_bottom_action(action.id)
                  })
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
  )
}
