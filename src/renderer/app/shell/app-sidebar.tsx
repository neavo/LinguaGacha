import { ChevronDown, SunMoon, Type } from "lucide-react";

import type {
  AppearanceMenuActionId,
  BottomAction,
  BottomActionId,
  NavigationGroup,
  RouteId,
} from "@/app/navigation/types";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/shadcn/sidebar";
import { useI18n, type LocaleKey } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import "@/app/shell/app-sidebar.css";

const SIDEBAR_PROFILE_ICON_URL: string = new URL("icon.png", document.baseURI).toString();

type AppSidebarProps = {
  groups: NavigationGroup[];
  bottom_actions: BottomAction[];
  selected_route: RouteId;
  expanded_items: ReadonlySet<RouteId>;
  disabled_route_ids: ReadonlySet<RouteId>;
  disabled_bottom_action_ids: ReadonlySet<BottomActionId>;
  badged_bottom_action_ids: ReadonlySet<BottomActionId>;
  profile_label_key: LocaleKey;
  profile_tooltip_key: LocaleKey;
  is_profile_update_available: boolean;
  on_select_route: (route_id: RouteId) => void;
  on_toggle_group: (route_id: RouteId) => void;
  on_bottom_action: (action_id: BottomActionId) => void;
  on_appearance_menu_action: (action_id: AppearanceMenuActionId) => void;
  on_profile_action: () => void;
};

export function AppSidebar(props: AppSidebarProps): JSX.Element {
  const { t } = useI18n();
  const { state } = useSidebar();
  const is_collapsed = state === "collapsed";

  return (
    <Sidebar
      collapsible="icon"
      className="shell-sidebar top-10 h-[calc(100svh-40px)] border-r border-sidebar-border"
    >
      <SidebarContent className="shell-sidebar__scroll">
        {props.groups.map((group, group_index) => (
          <div
            key={group.id}
            className={cn(
              "sidebar-group-wrapper",
              group_index === 0 && "sidebar-group-wrapper--first",
              group_index > 0 && "sidebar-group-wrapper--separated",
            )}
          >
            {group_index > 0 ? (
              <SidebarSeparator className="sidebar-group-separator mx-0 w-full" />
            ) : null}
            <SidebarGroup className="sidebar-group">
              <SidebarGroupContent>
                <SidebarMenu className="sidebar-group__items">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const has_children = (item.children?.length ?? 0) > 0;
                    const has_active_child =
                      item.children?.some((child) => child.id === props.selected_route) ?? false;
                    const is_active = props.selected_route === item.id;
                    const is_expanded = has_children && props.expanded_items.has(item.id);
                    const is_subitems_open = !is_collapsed && is_expanded;
                    const is_disabled =
                      props.disabled_route_ids.has(item.id) ||
                      (has_children &&
                        (item.children?.every((child) => {
                          return props.disabled_route_ids.has(child.id);
                        }) ??
                          false));

                    return (
                      <SidebarMenuItem key={item.id} className="sidebar-entry">
                        <SidebarMenuButton
                          className={cn(
                            "sidebar-item",
                            is_active && "sidebar-item--active",
                            has_active_child && "sidebar-item--parent-active",
                          )}
                          isActive={is_active}
                          disabled={is_disabled}
                          tooltip={t(item.title_key)}
                          onClick={() => {
                            if (has_children) {
                              props.on_toggle_group(item.id);
                              props.on_select_route(item.id);
                            } else {
                              props.on_select_route(item.id);
                            }
                          }}
                          aria-label={t(item.title_key)}
                        >
                          <Icon size={18} className="sidebar-item__icon" />
                          <span className={cn("sidebar-item__label", is_active && "font-medium")}>
                            {t(item.title_key)}
                          </span>
                          {has_children ? (
                            <ChevronDown
                              size={15}
                              className={cn(
                                "sidebar-item__chevron",
                                is_expanded && "sidebar-item__chevron--expanded",
                              )}
                            />
                          ) : null}
                        </SidebarMenuButton>
                        {has_children ? (
                          <div
                            className={cn(
                              "sidebar-subitems-shell",
                              is_subitems_open && "sidebar-subitems-shell--expanded",
                            )}
                            aria-hidden={!is_subitems_open}
                          >
                            <SidebarMenuSub className="sidebar-subitems border-0 mx-0 translate-x-0 px-0 py-0">
                              {item.children?.map((child) => {
                                const ChildIcon = child.icon;
                                const is_child_active = child.id === props.selected_route;
                                const is_child_disabled = props.disabled_route_ids.has(child.id);

                                return (
                                  <SidebarMenuSubItem key={child.id}>
                                    <SidebarMenuSubButton
                                      asChild
                                      isActive={is_child_active}
                                      className={cn(
                                        "sidebar-subitem",
                                        is_child_active && "sidebar-subitem--active",
                                      )}
                                    >
                                      <button
                                        disabled={is_child_disabled}
                                        onClick={() => {
                                          props.on_select_route(child.id);
                                        }}
                                        aria-label={t(child.title_key)}
                                        tabIndex={is_subitems_open ? 0 : -1}
                                      >
                                        <ChildIcon size={16} className="sidebar-subitem__icon" />
                                        <span
                                          className={cn(
                                            "sidebar-subitem__label",
                                            is_child_active && "font-medium",
                                          )}
                                        >
                                          {t(child.title_key)}
                                        </span>
                                      </button>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </div>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>

      <SidebarFooter className="shell-sidebar__bottom">
        <SidebarMenu className="sidebar-bottom-actions">
          {props.bottom_actions.map((action) => {
            const ActionIcon = action.icon;
            const is_action_disabled = props.disabled_bottom_action_ids.has(action.id);
            const has_badge = props.badged_bottom_action_ids.has(action.id);

            if (action.id === "theme") {
              return (
                <SidebarMenuItem key={action.id}>
                  <AppDropdownMenu>
                    <AppDropdownMenuTrigger asChild>
                      <SidebarMenuButton
                        className="sidebar-bottom-button"
                        disabled={is_action_disabled}
                        aria-label={t(action.label_key)}
                      >
                        <ActionIcon size={16} className="sidebar-bottom-button__icon" />
                        <span className="sidebar-bottom-button__text">{t(action.label_key)}</span>
                      </SidebarMenuButton>
                    </AppDropdownMenuTrigger>
                    <AppDropdownMenuContent
                      side={is_collapsed ? "right" : "top"}
                      align="center"
                      sideOffset={is_collapsed ? 8 : 4}
                      matchTriggerWidth={!is_collapsed}
                      className={cn(!is_collapsed && "w-(--radix-dropdown-menu-trigger-width)")}
                    >
                      <AppDropdownMenuGroup>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            props.on_appearance_menu_action("font-family");
                          }}
                        >
                          <Type size={16} />
                          <span>{t("app.navigation_action.toggle_lg_base_font")}</span>
                        </AppDropdownMenuItem>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            props.on_appearance_menu_action("theme-mode");
                          }}
                        >
                          <SunMoon size={16} />
                          <span>{t("app.navigation_action.switch_theme")}</span>
                        </AppDropdownMenuItem>
                      </AppDropdownMenuGroup>
                    </AppDropdownMenuContent>
                  </AppDropdownMenu>
                </SidebarMenuItem>
              );
            }

            return (
              <SidebarMenuItem key={action.id}>
                <SidebarMenuButton
                  className="sidebar-bottom-button"
                  disabled={is_action_disabled}
                  tooltip={t(action.label_key)}
                  aria-label={t(action.label_key)}
                  onClick={() => {
                    props.on_bottom_action(action.id);
                  }}
                >
                  <span className="sidebar-bottom-button__icon-wrap">
                    <ActionIcon size={16} className="sidebar-bottom-button__icon" />
                    {has_badge ? (
                      <span className="sidebar-bottom-button__badge-dot" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="sidebar-bottom-button__text">{t(action.label_key)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(
                "sidebar-profile",
                props.is_profile_update_available && "sidebar-profile--update",
              )}
              tooltip={t(props.profile_tooltip_key)}
              aria-label={t(props.profile_tooltip_key)}
              onClick={props.on_profile_action}
            >
              <span className="sidebar-profile__avatar">
                <img
                  className="sidebar-profile__avatar-image"
                  src={SIDEBAR_PROFILE_ICON_URL}
                  alt="LinguaGacha"
                />
                {props.is_profile_update_available ? (
                  <span className="sidebar-profile__update-dot" aria-hidden="true" />
                ) : null}
              </span>
              <span className="sidebar-profile__text font-medium">
                {t(props.profile_label_key)}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
