import { type JSX, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { type BeforePageLeave, type PageLeaveScope, PageLeaveContext } from "./page-leave-context";

/** 主窗口协调已挂载编辑器的保存，草稿和提交仍归编辑器。 */
export function PageLeaveProvider({ children }: { children: ReactNode }): JSX.Element {
  const handlers = useRef(new Map<symbol, { flush: BeforePageLeave; scope: PageLeaveScope }>());
  const pending_ref = useRef(false); // React 提交前也要阻止重复离页请求。
  const [leaving, set_leaving] = useState(false);
  /** 页面卸载时只释放自己的动作注册。 */
  const register_before_leave = useCallback(
    (flush: BeforePageLeave, scope: PageLeaveScope = { kind: "global" }): (() => void) => {
      const id = Symbol();
      handlers.current.set(id, { flush, scope });
      return () => {
        handlers.current.delete(id);
      };
    },
    [],
  );
  /** 所有编辑器都完成并仍属本次离开范围时，才允许壳层完成离开。 */
  const prepare_page_leave = useCallback(async (scope?: PageLeaveScope): Promise<boolean> => {
    if (pending_ref.current) return false;
    const matches = (candidate: PageLeaveScope) =>
      scope === undefined ||
      (scope.kind === "global"
        ? candidate.kind === "global"
        : candidate.kind === "project" && candidate.projectId === scope.projectId);
    const editors = [...handlers.current].filter(([, entry]) => matches(entry.scope));
    if (editors.length === 0) return true;
    pending_ref.current = true;
    set_leaving(true);
    try {
      let saved = true;
      // 顺序保存，避免同一工程的独占写入闸拒绝同时发起的保存。
      for (const [, { flush }] of editors) {
        if (!(await flush())) saved = false;
      }
      return saved && editors.every(([id]) => handlers.current.has(id));
    } finally {
      pending_ref.current = false;
      set_leaving(false);
    }
  }, []);
  const value = useMemo(
    () => ({ leaving, register_before_leave, prepare_page_leave }),
    [leaving, register_before_leave, prepare_page_leave],
  );
  return <PageLeaveContext.Provider value={value}>{children}</PageLeaveContext.Provider>;
}
