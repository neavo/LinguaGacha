import { createContext, useContext } from "react";

/** 根菜单提供关闭动作，Portal 中的子菜单沿 React 树访问同一入口。 */
export const MenuCloseContext = createContext<(() => void) | null>(null);

/** 特殊子菜单项目选择后关闭最外层菜单。 */
export function useAppDropdownMenuClose(): () => void {
  const close = useContext(MenuCloseContext);
  if (close === null) throw new Error("Menu close requires an AppDropdownMenu root.");
  return close;
}
