import { createContext, useContext, useCallback } from "react";

import { ProjectScopeContext } from "./project-scope-context";

export type PageLeaveScope = { kind: "global" } | { kind: "project"; projectId: string };
export type BeforePageLeave = () => Promise<boolean>;
type PageLeaveContextValue = {
  leaving: boolean;
  prepare_page_leave: (scope?: PageLeaveScope) => Promise<boolean>;
  register_before_leave: (handler: BeforePageLeave, scope?: PageLeaveScope) => () => void;
};
export const PageLeaveContext = createContext<PageLeaveContextValue | null>(null);

/** 页面注册保存动作，壳层等待当前动作后离开。 */
export function usePageLeave(): PageLeaveContextValue {
  const context = useContext(PageLeaveContext);
  const project = useContext(ProjectScopeContext);
  const register = context?.register_before_leave;
  const projectId = project?.projectId;
  const register_before_leave = useCallback(
    (handler: BeforePageLeave, scope?: PageLeaveScope) => {
      if (!register) throw new Error("PageLeaveProvider is missing.");
      return register(handler, scope ?? (projectId ? { kind: "project", projectId } : undefined));
    },
    [register, projectId],
  );
  if (context === null) throw new Error("usePageLeave requires PageLeaveProvider");
  return { ...context, register_before_leave };
}
