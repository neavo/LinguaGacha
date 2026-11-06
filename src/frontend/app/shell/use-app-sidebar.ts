import { useEffect, useState } from "react";

const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";
const SIDEBAR_EXPAND_QUERY = "(min-width: 1440px)";

/** 手动偏好跨会话保留，自动切换只调整当前显示。 */
export function useAppSidebar(): {
  is_sidebar_collapsed: boolean;
  on_open_change: (open: boolean) => void;
} {
  const [width_query] = useState(() => window.matchMedia(SIDEBAR_EXPAND_QUERY));
  const [sidebar, set_sidebar] = useState(() => {
    const prefers_collapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
    return {
      prefers_collapsed,
      is_collapsed: prefers_collapsed && !width_query.matches,
    };
  });

  useEffect(() => {
    // 仅跨断点时重新判断，让同一宽度区间内的手动选择持续生效。
    function on_width_change(): void {
      const is_wide = width_query.matches;
      set_sidebar((current) =>
        current.prefers_collapsed ? { ...current, is_collapsed: !is_wide } : current,
      );
    }
    width_query.addEventListener("change", on_width_change);
    return () => width_query.removeEventListener("change", on_width_change);
  }, [width_query]);

  return {
    is_sidebar_collapsed: sidebar.is_collapsed,
    // 仅手动操作保存偏好，当前显示可能已被宽度规则临时覆盖。
    on_open_change: (open) => {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!open));
      set_sidebar({ prefers_collapsed: !open, is_collapsed: !open });
    },
  };
}
