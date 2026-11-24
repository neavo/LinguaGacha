import type { JSX } from "react";
import "@frontend/app/shell/app-titlebar.css";

type AppTitlebarProps = {
  title: string;
};

/** 标题栏使用宿主提供的安全区与版本。 */
export function AppTitlebar(props: AppTitlebarProps): JSX.Element {
  const version = window.desktopApp.appVersion;
  const version_label = /^v/iu.test(version) ? version : `v${version}`;
  const shell_info = window.desktopApp.shell; // 标题栏安全区统一来自 preload 暴露的桌面壳层信息，避免渲染层再猜平台细节
  return (
    <header className="shell-topbar" data-titlebar-control-side={shell_info.titleBarControlSide}>
      <div className="topbar__safe-area topbar__safe-area--start" aria-hidden="true" />
      <div className="topbar__content">
        <strong className="topbar__brand font-medium">
          {props.title} {version_label}
        </strong>
      </div>
      <div className="topbar__safe-area topbar__safe-area--end" aria-hidden="true" />
    </header>
  );
}
