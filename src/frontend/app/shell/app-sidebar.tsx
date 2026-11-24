import { ProjectSidebar, ProjectSidebarDrop } from "./project-sidebar";
import { useRef, useState, type CSSProperties, type JSX, type ComponentProps } from "react";
import { Languages, ScrollText } from "lucide-react";

import type { NavigationGroup, RouteId } from "@frontend/app/navigation/types";
import { is_app_language, type AppLanguage } from "@domain/app-language";
import { APP_LANGUAGE_DEFINITIONS } from "@domain/app-language";
import { AppAppearanceMenu } from "@frontend/app/shell/app-appearance-menu";
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

const SIDEBAR_WIDTH = { min: 220, max: 480, step: 20 } as const;
const SIDEBAR_WIDTH_STORAGE_KEY = "lg-sidebar-width";
const SIDEBAR_PROFILE_ICON_URL: string = new URL("icon.png", document.baseURI).toString();

type AppSidebarProps = {
  groups: NavigationGroup[];
  projects?: ComponentProps<typeof ProjectSidebar> | undefined;
  selected_route: RouteId;
  app_language: AppLanguage;
  is_language_updating: boolean;
  show_log_badge: boolean;
  profile_label_key: LocaleKey;
  profile_tooltip_key: LocaleKey;
  is_profile_update_available: boolean;
  on_select_route: (route_id: RouteId) => void;
  on_open_logs: () => void;
  on_select_app_language: (language: AppLanguage) => void;
  on_profile_action: () => void;
};
/** 侧栏管理本机宽度偏好，导航与语言选择由宿主处理。 */
export function AppSidebar(props: AppSidebarProps): JSX.Element {
  const { t } = useI18n();
  const [width, set_width] = useState(() => {
    const saved = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const value = Number.parseInt(saved ?? "", 10);
    return Number.isFinite(value) ? clamp_width(value) : SIDEBAR_WIDTH.min;
  });
  const sidebar_ref = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null); // 取消拖动时恢复起点宽度。

  /** 提交时才写入本机偏好，拖动预览只更新界面。 */
  function save_width(value: number): void {
    const next = clamp_width(value);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
    set_width(next);
  }

  return (
    <aside
      ref={sidebar_ref}
      id="shell-navigation"
      className="shell-sidebar"
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
    >
      <nav className="shell-sidebar__navigation">
        {props.groups.map((group, group_index) => (
          <div key={group.id}>
            {group_index > 0 ? <hr className="sidebar-group-separator" /> : null}
            <ul className="sidebar-group">
              {group.items.map((item) => {
                const Icon = item.icon;

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="sidebar-row"
                      data-active={props.selected_route === item.id}
                      aria-current={props.selected_route === item.id ? "page" : undefined}
                      onClick={() => props.on_select_route(item.id)}
                      aria-label={t(item.title_key)}
                    >
                      <Icon className="sidebar-row__icon" />
                      <span className="sidebar-row__label">{t(item.title_key)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {props.projects && (
        <>
          <ProjectSidebar {...props.projects} />
          <ProjectSidebarDrop target_ref={sidebar_ref} />
        </>
      )}

      <footer className="shell-sidebar__bottom">
        <ul>
          <li>
            <button
              type="button"
              className="sidebar-row"
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
            </button>
          </li>

          <AppAppearanceMenu />

          <li>
            <AppDropdownMenu>
              <AppDropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="sidebar-row"
                    disabled={props.is_language_updating}
                    aria-label={t("app.navigation_action.language")}
                  >
                    <Languages className="sidebar-row__icon" />
                    <span className="sidebar-row__label">
                      {t("app.navigation_action.language")}
                    </span>
                  </button>
                }
              />
              <AppDropdownMenuContent
                side="top"
                align="center"
                sideOffset={4}
                matchTriggerWidth
                className="w-(--anchor-width)"
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
          </li>
        </ul>

        <ul>
          <li>
            <button
              type="button"
              className={cn(
                "sidebar-row",
                props.is_profile_update_available && "sidebar-profile--update",
              )}
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
            </button>
          </li>
        </ul>
      </footer>
      <div
        className="shell-sidebar__resize"
        role="separator"
        tabIndex={0}
        aria-label={t("app.navigation_action.resize_sidebar")}
        aria-controls="shell-navigation"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_WIDTH.min}
        aria-valuemax={SIDEBAR_WIDTH.max}
        aria-valuenow={width}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current !== null && event.currentTarget.hasPointerCapture(event.pointerId))
            set_width(clamp_width(drag.current.width + event.clientX - drag.current.x));
        }}
        onPointerUp={(event) => {
          if (drag.current === null || !event.currentTarget.hasPointerCapture(event.pointerId))
            return;
          save_width(drag.current.width + event.clientX - drag.current.x);
        }}
        onPointerCancel={() => {
          if (drag.current !== null) set_width(drag.current.width);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          let next: number;
          switch (event.key) {
            case "ArrowLeft":
              next = width - SIDEBAR_WIDTH.step;
              break;
            case "ArrowRight":
              next = width + SIDEBAR_WIDTH.step;
              break;
            case "Home":
              next = SIDEBAR_WIDTH.min;
              break;
            case "End":
              next = SIDEBAR_WIDTH.max;
              break;
            default:
              return;
          }
          event.preventDefault();
          save_width(next);
        }}
      />
    </aside>
  );
}

/** 恢复偏好、拖动预览和提交宽度共用同一组边界。 */
function clamp_width(value: number): number {
  return Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, value));
}
