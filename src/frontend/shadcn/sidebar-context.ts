import * as React from "react";

export type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

export const SidebarContext = React.createContext<SidebarContextProps | null>(null);

/** 标题栏和侧边栏共用展开状态与切换入口。 */
export function useSidebar(): SidebarContextProps {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}
