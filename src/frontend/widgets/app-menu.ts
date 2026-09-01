import type { Menu as MenuPrimitive } from "@base-ui/react/menu";

/** 菜单浮层与窗口边缘之间的安全距离。 */
export const APP_MENU_VIEWPORT_PADDING = 8;

/** 父菜单与二级浮层之间的水平距离。 */
export const APP_MENU_SUBMENU_SIDE_OFFSET = 8;

/** 嵌套菜单由菜单树维护生命周期，不以父子浮层间的焦点 handoff 作为关闭信号。 */
export function should_keep_submenu_open(
  open: boolean,
  reason: MenuPrimitive.Root.ChangeEventReason,
): boolean {
  return !open && reason === "focus-out";
}
