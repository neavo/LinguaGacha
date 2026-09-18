import { createContext, useContext } from "react";

export type BeforePageLeave = () => Promise<boolean>;
type PageLeaveContextValue = {
  leaving: boolean;
  prepare_page_leave: () => Promise<boolean>;
  register_before_leave: (handler: BeforePageLeave) => () => void;
};
export const PageLeaveContext = createContext<PageLeaveContextValue | null>(null);

/** 页面注册保存动作，壳层等待当前动作后离开。 */
export function usePageLeave(): PageLeaveContextValue {
  const context = useContext(PageLeaveContext);
  if (context === null) throw new Error("usePageLeave requires PageLeaveProvider");
  return context;
}
