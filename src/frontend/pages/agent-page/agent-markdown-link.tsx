import { useContext, useRef, type ComponentProps, type JSX } from "react";
import type { ExtraProps } from "streamdown";
import { resolve_agent_workspace_href } from "@shared/agent-workspace-file";
import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AgentFileTrigger } from "./agent-file-trigger";
import { AgentFileContext, AgentMarkdownPathContext } from "./agent-file-context";

/** 链接负责外链与锚点，工作区文件交给统一文件入口。 */
export function AgentMarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & ExtraProps): JSX.Element {
  const { t } = useI18n();
  const documents = useContext(AgentFileContext);
  const base_path = useContext(AgentMarkdownPathContext);
  const pending = useRef(false);
  if (!href) return <span>{children}</span>;
  const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href);
  if (!external && !href.startsWith("#")) {
    if (!documents) return <span>{children}</span>;
    let path: string;
    try {
      path = resolve_agent_workspace_href(href, base_path);
    } catch {
      return <span>{children}</span>;
    }
    return (
      <AgentFileTrigger path={path} render={<a {...props} href={href} />}>
        {children}
      </AgentFileTrigger>
    );
  }
  /** 宿主打开外链期间合并重复点击，失败只在入口反馈一次。 */
  const activate = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    try {
      await open_external_url(href.startsWith("//") ? `https:${href}` : href);
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("agent_page.error.activate_link")),
      );
    } finally {
      pending.current = false;
    }
  };
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
        void activate();
      }}
    >
      {children}
    </a>
  );
}
