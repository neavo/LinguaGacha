import { useEffect, useState } from "react";

import type { RouteId } from "@frontend/app/navigation/types";

const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";

type AppSidebarState = {
  route: RouteId; // 已同步侧栏策略的页面。
  preferred_collapsed: boolean; // 用户选择跨页面、跨会话保留。
  auto_collapsed: boolean; // 临时折叠只持续到本次访问结束或用户手动切换。
};

/** 管理侧栏偏好，为每次 Agent 访问临时腾出工作空间。 */
export function useAppSidebar(selected_route: RouteId): {
  is_sidebar_collapsed: boolean;
  on_open_change: (open: boolean) => void;
} {
  const [state, set_state] = useState<AppSidebarState>(() => ({
    route: selected_route,
    preferred_collapsed: window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
    auto_collapsed: selected_route === "agent",
  }));
  // 实际路由改变时在提交子树前重置临时状态，避免先展示上一页布局再触发折叠。
  if (state.route !== selected_route) {
    set_state({ ...state, route: selected_route, auto_collapsed: selected_route === "agent" });
  }

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(state.preferred_collapsed));
  }, [state.preferred_collapsed]);

  /** 手动选择立即接管布局，并成为其它页面使用的偏好。 */
  function on_open_change(open: boolean): void {
    set_state((current) => ({
      ...current,
      preferred_collapsed: !open,
      auto_collapsed: false,
    }));
  }

  return {
    is_sidebar_collapsed: state.preferred_collapsed || state.auto_collapsed,
    on_open_change,
  };
}
