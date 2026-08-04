import { isValidElement, useEffect, useId, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MermaidConfig } from "mermaid";
import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-provider";

type AgentMarkdownProps = {
  text: string;
  streaming: boolean;
};

type MermaidThemeMode = "light" | "dark";

type MermaidRenderState =
  | { key: string; status: "success"; svg: string }
  | { key: string; status: "error" }
  | null;

type MermaidCodeElementProps = {
  className?: string;
  children?: ReactNode;
};

/** 渲染 Agent 正文 Markdown；图表仅在完整消息内进入 Mermaid 异步边界。 */
export function AgentMarkdown(props: AgentMarkdownProps): JSX.Element {
  const { t } = useI18n();
  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (href !== undefined) void open_external_url(href);
        }}
      >
        {children}
      </a>
    ),
    img: ({ alt }) => (
      <span className="agent-message__image-alt">
        {alt?.trim() || t("agent_page.image.omitted")}
      </span>
    ),
    pre: ({ node: _node, children, ...pre_props }) => {
      const source = read_mermaid_source(children);
      return !props.streaming && source !== null ? (
        <AgentMermaid source={source} />
      ) : (
        <pre {...pre_props}>{children}</pre>
      );
    },
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {props.text}
    </ReactMarkdown>
  );
}

/** 主题或源码变化时重建图表；旧异步结果由 effect 生命周期丢弃。 */
function AgentMermaid({ source }: { source: string }): JSX.Element {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const diagram_id = `agent-mermaid-${useId().replaceAll(":", "")}`;
  const theme_mode = resolve_mermaid_theme(resolvedTheme);
  const render_key = `${theme_mode}\u0000${source}`;
  const [render_state, set_render_state] = useState<MermaidRenderState>(null);

  useEffect(() => {
    let active = true;
    void render_mermaid(diagram_id, source, theme_mode).then(
      (svg) => {
        if (active) set_render_state({ key: render_key, status: "success", svg });
      },
      () => {
        if (active) set_render_state({ key: render_key, status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [diagram_id, render_key, source, theme_mode]);

  if (render_state?.key !== render_key) return <MermaidSource source={source} />;
  if (render_state.status === "error") {
    return (
      <div className="agent-message__diagram-error">
        <p>{t("agent_page.diagram.render_failed")}</p>
        <MermaidSource source={source} />
      </div>
    );
  }
  return (
    <figure
      className="agent-message__diagram"
      aria-label={t("agent_page.diagram.label")}
      tabIndex={0}
      dangerouslySetInnerHTML={{ __html: render_state.svg }}
    />
  );
}

/** Mermaid 未完成或失败时保留可复制、可诊断的原始围栏正文。 */
function MermaidSource({ source }: { source: string }): JSX.Element {
  return (
    <pre>
      <code className="language-mermaid">{source}</code>
    </pre>
  );
}

/** 只把显式 `mermaid` 围栏交给图表渲染器，普通代码块保持原样。 */
function read_mermaid_source(children: ReactNode): string | null {
  if (!isValidElement<MermaidCodeElementProps>(children)) return null;
  const class_name = children.props.className;
  if (class_name === undefined || !class_name.split(/\s+/u).includes("language-mermaid")) {
    return null;
  }
  return String(children.props.children ?? "").replace(/\n$/u, "");
}

/** next-themes 尚未收敛时，以根节点当前 class 作为首帧主题事实。 */
function resolve_mermaid_theme(resolved_theme: string | undefined): MermaidThemeMode {
  return resolved_theme === "dark" ||
    (resolved_theme !== "light" && document.documentElement.classList.contains("dark"))
    ? "dark"
    : "light";
}

/** Mermaid 自带渲染队列；这里只应用当前主题，不维护第二套调度状态。 */
async function render_mermaid(
  id: string,
  source: string,
  theme_mode: MermaidThemeMode,
): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize(build_mermaid_config(theme_mode));
  return (await mermaid.render(id, source)).svg;
}

/** 只从全局设计 token 投影安全主题，图表源码不能覆盖这些宿主约束。 */
function build_mermaid_config(theme_mode: MermaidThemeMode): MermaidConfig {
  const style = getComputedStyle(document.documentElement);
  const read_token = (name: string): string => style.getPropertyValue(name).trim();
  const font_family = "var(--ui-font-family-base)";
  const theme_variables = {
    background: read_token("--popover"),
    primaryColor: read_token("--muted"),
    primaryTextColor: read_token("--foreground"),
    primaryBorderColor: read_token("--border"),
    secondaryColor: read_token("--accent"),
    tertiaryColor: read_token("--secondary"),
    lineColor: read_token("--muted-foreground"),
    fontFamily: font_family,
    fontSize: "13px",
    darkMode: theme_mode === "dark",
  };
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    secure: ["theme", "themeVariables", "themeCSS", "fontFamily"],
    fontFamily: font_family,
    themeVariables: theme_variables,
    flowchart: { useMaxWidth: true },
  };
}
