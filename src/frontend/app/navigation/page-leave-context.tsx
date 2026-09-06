import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type BeforePageLeave = () => Promise<boolean>;
type PageLeaveContextValue = {
  leaving: boolean;
  prepare_page_leave: () => Promise<boolean>;
  register_before_leave: (handler: BeforePageLeave) => () => void;
};
const PageLeaveContext = createContext<PageLeaveContextValue | null>(null);

/** 主窗口只持有当前页面的离开前动作，草稿和保存仍由页面拥有。 */
export function PageLeaveProvider({ children }: { children: ReactNode }): JSX.Element {
  const handler_ref = useRef<BeforePageLeave | null>(null); // 当前页面注册的保存动作，同时作为离页身份。
  const pending_ref = useRef(false); // React 提交前也要阻止重复离页请求。
  const [leaving, set_leaving] = useState(false);
  /** 页面卸载时只释放自己的动作注册。 */
  const register_before_leave = useCallback((handler: BeforePageLeave): (() => void) => {
    handler_ref.current = handler;
    return () => {
      if (handler_ref.current === handler) handler_ref.current = null;
    };
  }, []);
  /** 当前页面保存成功且身份有效时，才允许壳层完成离开。 */
  const prepare_page_leave = useCallback(async (): Promise<boolean> => {
    if (pending_ref.current) return false;
    const handler = handler_ref.current;
    if (handler === null) return true;
    pending_ref.current = true;
    set_leaving(true);
    try {
      const saved = await handler();
      return saved && handler_ref.current === handler;
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

/** 页面注册保存动作，壳层等待当前动作后离开。 */
export function usePageLeave(): PageLeaveContextValue {
  const context = useContext(PageLeaveContext);
  if (context === null) throw new Error("usePageLeave requires PageLeaveProvider");
  return context;
}
