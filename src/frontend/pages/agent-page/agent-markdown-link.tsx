import { useContext, useRef, type ComponentProps, type JSX } from "react";
import type { ExtraProps } from "streamdown";
import { is_agent_file_href, resolve_agent_file_href } from "@shared/agent-workspace-file";
import { normalize_external_link, useExternalLink } from "@frontend/app/desktop/use-external-link";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppContextMenuItem } from "@frontend/widgets/app-context-menu";
import { AgentFileTrigger } from "./agent-file-trigger";
import { AgentFileContext, AgentMarkdownPathContext } from "./agent-file-context";
import { AgentLinkMenu } from "./agent-link-menu";

/** 链接负责外链与锚点，本机文件交给统一文件入口。 */
export function AgentMarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & ExtraProps): JSX.Element {
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
    <AgentMarkdownNavigationLink {...props} href={href} in_document={base_path !== ""}>
      {children}
    </AgentMarkdownNavigationLink>
  );
}

/** 外链和锚点的菜单首项沿用链接本身的点击行为。 */
function AgentMarkdownNavigationLink({
  href,
  in_document,
  ...props
}: ComponentProps<"a"> & { href: string; in_document: boolean }): JSX.Element {
  const { t } = useI18n();
  const activate = useExternalLink();
  const link = useRef<HTMLAnchorElement>(null);
  const is_anchor = href.startsWith("#");
  /** 文件预览只查当前文档，多个标签可能包含同名标题。 */
  const find_target = (): HTMLElement | null => {
    if (!link.current) return null;
    let id: string;
    try {
      id = decodeURIComponent(href.slice(1));
    } catch {
      return null;
    }
    if (!in_document) return link.current.ownerDocument.getElementById(id);
    const scope = link.current.closest(".agent-markdown");
    return (
      [...(scope?.querySelectorAll<HTMLElement>("[id]") ?? [])].find((node) => node.id === id) ??
      null
    );
  };

  return (
    <AgentLinkMenu
      trigger={{
        render: <a {...props} ref={link} href={href} />,
        className: "select-text",
        onClick: (event) => {
          if (event.defaultPrevented || (is_anchor && !in_document)) return;
          event.preventDefault();
          if (is_anchor) find_target()?.scrollIntoView({ block: "start" });
          else void activate(href);
        },
      }}
      copy_href={is_anchor ? undefined : normalize_external_link(href)}
      has_target={is_anchor ? () => find_target() !== null : undefined}
    >
      <AppContextMenuItem onClick={() => link.current?.click()}>
        {t(is_anchor ? "agent_page.link.jump_to_anchor" : "agent_page.link.open")}
      </AppContextMenuItem>
    </AgentLinkMenu>
  );
}
