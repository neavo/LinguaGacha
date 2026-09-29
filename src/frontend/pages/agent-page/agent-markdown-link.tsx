import { useContext, useEffect, useRef, useState, type ComponentProps, type JSX } from "react";
import type { ExtraProps } from "streamdown";
import { is_agent_markdown_path, resolve_agent_workspace_href } from "@shared/agent-workspace-file";
import type { AgentWorkspaceLinkResult } from "@shared/agent";
import { api_fetch, open_external_url } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { AgentDocumentContext, AgentMarkdownPathContext } from "./agent-document-context";

/** 链接组件统一拥有菜单和宿主交互，正文渲染只提供源路径。 */
export function AgentMarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & ExtraProps): JSX.Element {
  const { t } = useI18n();
  const documents = useContext(AgentDocumentContext);
  const base_path = useContext(AgentMarkdownPathContext);
  const [open, set_open] = useState(false);
  const pending = useRef(false); // 同一链接在保存对话框返回前只受理一次。
  useEffect(() => {
    if (documents?.active === false) set_open(false);
  }, [documents?.active]);
  if (!href) return <span>{children}</span>;
  const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href);
  const markdown =
    !external && !href.startsWith("#") && is_agent_markdown_path(href) && documents !== null;
  /** 菜单先关闭，再把查看交给页面，把保存和外链交给已有宿主入口。 */
  const activate = async (view: boolean): Promise<void> => {
    set_open(false);
    if (pending.current) return;
    pending.current = true;
    try {
      if (external) await open_external_url(href.startsWith("//") ? `https:${href}` : href);
      else {
        const path = resolve_agent_workspace_href(href, base_path);
        if (view && documents) await documents.open_document(path);
        else {
          const result = await api_fetch<AgentWorkspaceLinkResult>(
            "/api/agent/workspace/activate-path",
            { path },
          );
          if (result.status === "saved") push_toast("success", t("agent_page.file_saved"));
        }
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("agent_page.error.activate_link")),
      );
    } finally {
      pending.current = false;
    }
  };
  if (markdown)
    return (
      <AppDropdownMenu open={open && documents.active} onOpenChange={set_open}>
        <AppDropdownMenuTrigger
          nativeButton={false}
          render={<a {...props} href={href} onClick={(event) => event.preventDefault()} />}
        >
          {children}
        </AppDropdownMenuTrigger>
        {documents.active ? (
          <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
            <AppDropdownMenuItem onClick={() => void activate(true)}>
              {t("agent_page.document.view")}
            </AppDropdownMenuItem>
            <AppDropdownMenuItem onClick={() => void activate(false)}>
              {t("agent_page.document.save_as")}
            </AppDropdownMenuItem>
          </AppDropdownMenuContent>
        ) : null}
      </AppDropdownMenu>
    );
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        if (href.startsWith("#")) {
          if (!base_path) return;
          event.preventDefault();
          let id: string;
          try {
            id = decodeURIComponent(href.slice(1));
          } catch {
            return;
          }
          const scope = event.currentTarget.closest(".agent-markdown");
          [...(scope?.querySelectorAll<HTMLElement>("[id]") ?? [])]
            .find((node) => node.id === id)
            ?.scrollIntoView({ block: "start" });
          return;
        }
        event.preventDefault();
        void activate(false);
      }}
    >
      {children}
    </a>
  );
}
