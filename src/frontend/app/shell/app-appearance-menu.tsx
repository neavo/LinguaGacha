import { Palette } from "lucide-react";

import {
  type FontPreference,
  type ThemePreference,
  useAppearance,
} from "@frontend/app/appearance/appearance-provider";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { cn } from "@frontend/shadcn/classnames";
import { SidebarMenuButton, SidebarMenuItem } from "@frontend/shadcn/sidebar";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuLabel,
  AppDropdownMenuRadioGroup,
  AppDropdownMenuRadioItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";

type AppAppearanceMenuProps = {
  is_collapsed: boolean;
};

function is_font_preference(value: string): value is FontPreference {
  return value === "lg-base" || value === "system";
}

function is_theme_preference(value: string): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** 以显式单选项呈现完整外观偏好，避免切换按钮隐藏当前状态和可选目标。 */
export function AppAppearanceMenu(props: AppAppearanceMenuProps): JSX.Element {
  const { t } = useI18n();
  const { font_preference, set_font_preference, set_theme_preference, theme_preference } =
    useAppearance();
  const appearance_label = t("app.navigation_action.appearance");
  const font_label = t("app.navigation_action.font");
  const theme_label = t("app.navigation_action.theme");

  return (
    <SidebarMenuItem>
      <AppDropdownMenu>
        <AppDropdownMenuTrigger asChild>
          <SidebarMenuButton
            className="sidebar-bottom-button"
            tooltip={appearance_label}
            aria-label={appearance_label}
          >
            <Palette size={16} className="sidebar-bottom-button__icon" />
            <span className="sidebar-bottom-button__text">{appearance_label}</span>
          </SidebarMenuButton>
        </AppDropdownMenuTrigger>
        <AppDropdownMenuContent
          side={props.is_collapsed ? "right" : "top"}
          align="center"
          sideOffset={props.is_collapsed ? 8 : 4}
          matchTriggerWidth={!props.is_collapsed}
          className={cn(!props.is_collapsed && "w-(--radix-dropdown-menu-trigger-width)")}
        >
          <AppDropdownMenuGroup>
            <AppDropdownMenuLabel>{font_label}</AppDropdownMenuLabel>
            <AppDropdownMenuRadioGroup
              aria-label={font_label}
              value={font_preference}
              onValueChange={(preference) => {
                if (is_font_preference(preference)) {
                  set_font_preference(preference);
                }
              }}
            >
              <AppDropdownMenuRadioItem value="lg-base">
                {t("app.navigation_action.font_option.lg_base")}
              </AppDropdownMenuRadioItem>
              <AppDropdownMenuRadioItem value="system">
                {t("app.navigation_action.font_option.system")}
              </AppDropdownMenuRadioItem>
            </AppDropdownMenuRadioGroup>
          </AppDropdownMenuGroup>
          <AppDropdownMenuGroup className="mt-1">
            <AppDropdownMenuLabel>{theme_label}</AppDropdownMenuLabel>
            <AppDropdownMenuRadioGroup
              aria-label={theme_label}
              value={theme_preference}
              onValueChange={(preference) => {
                if (is_theme_preference(preference)) {
                  set_theme_preference(preference);
                }
              }}
            >
              <AppDropdownMenuRadioItem value="system">
                {t("app.navigation_action.theme_option.system")}
              </AppDropdownMenuRadioItem>
              <AppDropdownMenuRadioItem value="light">
                {t("app.navigation_action.theme_option.light")}
              </AppDropdownMenuRadioItem>
              <AppDropdownMenuRadioItem value="dark">
                {t("app.navigation_action.theme_option.dark")}
              </AppDropdownMenuRadioItem>
            </AppDropdownMenuRadioGroup>
          </AppDropdownMenuGroup>
        </AppDropdownMenuContent>
      </AppDropdownMenu>
    </SidebarMenuItem>
  );
}
