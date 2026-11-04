import { useEffect, useState } from "react";

const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";

/** 管理跨页面、跨会话保留的侧栏折叠偏好。 */
export function useAppSidebar(): {
  is_sidebar_collapsed: boolean;
  on_open_change: (open: boolean) => void;
} {
  const [is_sidebar_collapsed, set_is_sidebar_collapsed] = useState<boolean>(
    () => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false", // 未保存过偏好时默认折叠
  );

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(is_sidebar_collapsed));
  }, [is_sidebar_collapsed]);

  return {
    is_sidebar_collapsed,
    on_open_change: (open) => set_is_sidebar_collapsed(!open),
  };
}
