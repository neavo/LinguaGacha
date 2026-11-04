import { useContext, type ComponentProps, type JSX } from "react";
import type { ExtraProps } from "streamdown";
import { is_agent_file_href, resolve_agent_file_href } from "@shared/agent-workspace-file";
import { useExternalLink } from "@frontend/app/desktop/use-external-link";
import { AgentFileTrigger } from "./agent-file-trigger";
import { AgentFileContext, AgentMarkdownPathContext } from "./agent-file-context";

/** 链接负责外链与锚点，本机文件交给统一文件入口。 */
export function AgentMarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & ExtraProps): JSX.Element {
  const activate = useExternalLink();
  const documents = useContext(AgentFileContext);
  const base_path = useContext(AgentMarkdownPathContext);
  if (!href) return <span>{children}</span>;
  if (is_agent_file_href(href)) {
    if (!documents) return <span>{children}</span>;
    let path: string;
    try {
      path = resolve_agent_file_href(href, base_path);
    } catch {
      return <span>{children}</span>;
    }
    return (
      <AgentFileTrigger path={path} render={<a {...props} href={href} />}>
        {children}
      </AgentFileTrigger>
    );
  }
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
        void activate(href);
      }}
    >
      {children}
    </a>
  );
}
