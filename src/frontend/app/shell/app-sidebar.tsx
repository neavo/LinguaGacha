import type { JSX } from "react";
import { ChevronDown, Languages, ScrollText } from "lucide-react";

import type { NavigationGroup, RouteId } from "@frontend/app/navigation/types";
import { is_app_language, type AppLanguage } from "@domain/app-language";
import { APP_LANGUAGE_DEFINITIONS } from "@domain/app-language";
import { AppAppearanceMenu } from "@frontend/app/shell/app-appearance-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@frontend/shadcn/sidebar";
import { useSidebar } from "@frontend/shadcn/sidebar-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { cn } from "@frontend/shadcn/classnames";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuRadioGroup,
  AppDropdownMenuRadioItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import "@frontend/app/shell/app-sidebar.css";

const SIDEBAR_PROFILE_ICON_URL: string = new URL("icon.png", document.baseURI).toString();

type AppSidebarProps = {
  groups: NavigationGroup[];
  selected_route: RouteId;
  expanded_items: ReadonlySet<RouteId>;
  disabled_route_ids: ReadonlySet<RouteId>;
  app_language: AppLanguage;
  is_language_updating: boolean;
  show_log_badge: boolean;
  profile_label_key: LocaleKey;
  profile_tooltip_key: LocaleKey;
  is_profile_update_available: boolean;
  on_select_route: (route_id: RouteId) => void;
  on_toggle_group: (route_id: RouteId) => void;
  on_open_logs: () => void;
  on_select_app_language: (language: AppLanguage) => void;
  on_profile_action: () => void;
};
/** 导航与语言选择由宿主状态驱动，侧栏只提交用户操作。 */
export function AppSidebar(props: AppSidebarProps): JSX.Element {
  const { t } = useI18n();
  const { state } = useSidebar();
  const is_collapsed = state === "collapsed";

  return (
    <Sidebar className="shell-sidebar top-10 h-[calc(100svh-40px)]">
      <SidebarContent className="shell-sidebar__scroll">
        {props.groups.map((group, group_index) => (
          <div key={group.id}>
            {group_index > 0 ? <SidebarSeparator className="sidebar-group-separator" /> : null}
            <SidebarGroup className="sidebar-group">
              <SidebarGroupContent>
                <SidebarMenu>
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
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          className={cn(
                            "sidebar-row",
                            !is_active && has_active_child && "sidebar-row--parent-active",
                          )}
                          isActive={is_active}
                          disabled={is_disabled}
                          tooltip={t(item.title_key)}
                          onClick={() => {
                            if (has_children) {
                              props.on_toggle_group(item.id);
                            }
                            props.on_select_route(item.id);
                          }}
                          aria-label={t(item.title_key)}
                        >
                          <Icon className="sidebar-row__icon" />
                          <span className="sidebar-row__label">{t(item.title_key)}</span>
                          {has_children ? (
                            <ChevronDown
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
                            <SidebarMenu className="sidebar-subitems">
                              {item.children?.map((child) => {
                                const ChildIcon = child.icon;
                                const is_child_active = child.id === props.selected_route;
                                const is_child_disabled = props.disabled_route_ids.has(child.id);

                                return (
                                  <SidebarMenuItem key={child.id}>
                                    <SidebarMenuButton
                                      isActive={is_child_active}
                                      className="sidebar-row"
                                      disabled={is_child_disabled}
                                      onClick={() => props.on_select_route(child.id)}
                                      aria-label={t(child.title_key)}
                                      tabIndex={is_subitems_open ? 0 : -1}
                                    >
                                      <ChildIcon className="sidebar-row__icon" />
                                      <span className="sidebar-row__label">
                                        {t(child.title_key)}
                                      </span>
                                    </SidebarMenuButton>
                                  </SidebarMenuItem>
                                );
                              })}
                            </SidebarMenu>
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="sidebar-row"
              tooltip={t("app.navigation_action.logs")}
              aria-label={t("app.navigation_action.logs")}
              onClick={props.on_open_logs}
            >
              <span className="sidebar-row__icon">
                <ScrollText size={16} />
                {props.show_log_badge ? (
                  <span className="sidebar-badge-dot" aria-hidden="true" />
                ) : null}
              </span>
              <span className="sidebar-row__label">{t("app.navigation_action.logs")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <AppAppearanceMenu is_collapsed={is_collapsed} />

          <SidebarMenuItem>
            <AppDropdownMenu>
              <AppDropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    className="sidebar-row"
                    disabled={props.is_language_updating}
                    aria-label={t("app.navigation_action.language")}
                  >
                    <Languages className="sidebar-row__icon" />
                    <span className="sidebar-row__label">
                      {t("app.navigation_action.language")}
                    </span>
                  </SidebarMenuButton>
                }
              />
              <AppDropdownMenuContent
                side={is_collapsed ? "right" : "top"}
                align="center"
                sideOffset={is_collapsed ? 8 : 4}
                matchTriggerWidth={!is_collapsed}
                className={cn(!is_collapsed && "w-(--anchor-width)")}
              >
                <AppDropdownMenuRadioGroup
                  value={props.app_language}
                  onValueChange={(language) => {
                    if (is_app_language(language)) {
                      props.on_select_app_language(language);
                    }
                  }}
                >
                  {APP_LANGUAGE_DEFINITIONS.map(({ code, name }) => (
                    <AppDropdownMenuRadioItem key={code} value={code}>
                      <span>{name}</span>
                    </AppDropdownMenuRadioItem>
                  ))}
                </AppDropdownMenuRadioGroup>
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(
                "sidebar-row",
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
                  <span className="sidebar-badge-dot" aria-hidden="true" />
                ) : null}
              </span>
              <span className="sidebar-row__label font-medium">{t(props.profile_label_key)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
