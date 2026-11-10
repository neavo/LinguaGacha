import type { JSX, ReactNode } from "react";
import "./settings-list.css";

/** 设置窗口共用滚动边界和纵向卡片间距。 */
export function SettingsList(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="settings-list__scroll">
      <div className="settings-list">{props.children}</div>
    </div>
  );
}
