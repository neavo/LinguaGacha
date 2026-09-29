import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type JSX, startTransition } from "react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { useSidebar } from "@frontend/shadcn/sidebar-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { resolve_shortcut_platform } from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import "@frontend/app/shell/app-titlebar.css";

type AppTitlebarProps = {
  title: string;
};

/** 标题栏共享侧栏切换入口，并用同一动作文案提供提示和无障碍名称。 */
export function AppTitlebar(props: AppTitlebarProps): JSX.Element {
  const { t } = useI18n();
  const { state, toggleSidebar } = useSidebar();
  const version = window.desktopApp.appVersion;
  const version_label = /^v/iu.test(version) ? version : `v${version}`;
  const shell_info = window.desktopApp.shell; // 标题栏安全区统一来自 preload 暴露的桌面壳层信息，避免渲染层再猜平台细节
  const SidebarToggleIcon = state === "expanded" ? PanelLeftClose : PanelLeftOpen;
  const toggle_label = t(
    state === "expanded"
      ? "app.navigation_action.collapse_sidebar"
      : "app.navigation_action.expand_sidebar",
  );
  const toggle_aria_shortcut = resolve_shortcut_platform() === "mac" ? "Meta+B" : "Control+B"; // ARIA 使用标准键名，键帽使用平台符号。
  /** 点击与快捷键共用低优先级布局更新，避免阻塞正在处理的输入。 */
  function handle_toggle_sidebar(): void {
    startTransition(toggleSidebar);
  }
  useActionShortcut({
    action: "toggle_sidebar",
    enabled: true,
    on_trigger: handle_toggle_sidebar,
  });

  return (
    <header
      className="titlebar shell-topbar"
      data-titlebar-control-side={shell_info.titleBarControlSide}
    >
      <div className="topbar__safe-area topbar__safe-area--start" aria-hidden="true" />
      <div className="topbar__content">
        <div className="topbar__left">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="topbar__menu-button"
                  aria-label={toggle_label}
                  aria-expanded={state === "expanded"}
                  aria-keyshortcuts={toggle_aria_shortcut}
                  onClick={handle_toggle_sidebar}
                >
                  <SidebarToggleIcon size={18} aria-hidden="true" />
                </button>
              }
            />
            <TooltipContent side="bottom" align="start">
              <ShortcutTooltipRow label={toggle_label} shortcut="toggle_sidebar" />
            </TooltipContent>
          </Tooltip>
          <div className="topbar__brand">
            <strong className="font-medium">
              {props.title} {version_label}
            </strong>
          </div>
        </div>
      </div>
      <div className="topbar__safe-area topbar__safe-area--end" aria-hidden="true" />
    </header>
  );
}
