import { useState, type ComponentProps, type JSX, type ReactNode } from "react";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuTrigger,
} from "@frontend/widgets/app-context-menu";

type AgentLinkMenuProps = {
  trigger: ComponentProps<typeof AppContextMenuTrigger>;
  children: ReactNode;
  copy_href?: string | undefined;
  has_target?: (() => boolean) | undefined;
};

/** 链接共用菜单与剪贴板反馈，目标动作由各自的入口提供。 */
export function AgentLinkMenu({
  trigger,
  children,
  copy_href,
  has_target,
}: AgentLinkMenuProps): JSX.Element {
  const { t } = useI18n();
  const [menu, set_menu] = useState({ has_target: true, selected_text: "" });

  /** 菜单关闭后通过统一通知确认剪贴板写入结果。 */
  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      push_toast("success", t("agent_page.action.copied"));
    } catch (error) {
      push_error_toast(t("app.feedback.copy_failed"), error);
    }
  };

  return (
    <AppContextMenu
      onOpenChange={(open, details) => {
        if (!open) return;
        const selected_text = read_context_selection(details.event);
        const target_available = has_target?.() ?? true;
        if (!target_available && selected_text === "") {
          details.cancel();
          return;
        }
        set_menu({ has_target: target_available, selected_text });
      }}
    >
      <AppContextMenuTrigger {...trigger} />
      <AppContextMenuContent>
        {menu.has_target ? children : null}
        {copy_href !== undefined ? (
          <AppContextMenuItem onClick={() => void copy(copy_href)}>
            {t("agent_page.link.copy")}
          </AppContextMenuItem>
        ) : null}
        {menu.selected_text !== "" ? (
          <AppContextMenuItem onClick={() => void copy(menu.selected_text)}>
            {t("agent_page.link.copy_selection")}
          </AppContextMenuItem>
        ) : null}
      </AppContextMenuContent>
    </AppContextMenu>
  );
}

/** 在菜单取得焦点前保存右键命中的选区。 */
function read_context_selection(event: Event): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return "";
  if (event instanceof MouseEvent && event.button === 2) {
    const { clientX, clientY } = event;
    const rects = selection.getRangeAt(0).getClientRects();
    const hits_selection = [...rects].some(
      ({ left, right, top, bottom }) =>
        clientX >= left && clientX <= right && clientY >= top && clientY <= bottom,
    );
    return hits_selection ? selection.toString() : "";
  }
  return event.target instanceof Node && selection.containsNode(event.target, true)
    ? selection.toString()
    : "";
}
