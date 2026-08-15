import { isValidElement, useEffect, useId, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import type { MermaidConfig } from "mermaid";
import { useAppearance } from "@frontend/app/appearance/appearance-provider";
import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type { ResolvedThemeMode } from "@gui/bridge-types";

import "./agent-markdown.css";

type AgentMarkdownProps = {
  text: string;
  streaming: boolean;
};

type MermaidRenderState =
  | { key: string; status: "success"; svg: string }
  | { key: string; status: "error" }
  | null;

type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

type CodeBlock = {
  language: string | null;
  source: string;
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
      <span className="agent-markdown__image-alt">
        {alt?.trim() || t("agent_page.image.omitted")}
      </span>
    ),
    pre: ({ node: _node, children, ...pre_props }) => {
      const code_block = read_code_block(children);
      if (!props.streaming && code_block?.language === "mermaid") {
        return <AgentMermaid source={code_block.source} />;
      }
      const language = code_block?.language;
      return (
        <pre
          {...pre_props}
          data-language={language === "mermaid" ? undefined : (language ?? undefined)}
        >
          {children}
        </pre>
      );
    },
  };

  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={
          props.streaming
            ? undefined
            : [[rehypeHighlight, { detect: false, plainText: ["mermaid"] }]]
        }
        components={components}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

/** 主题或源码变化时重建图表；旧异步结果由 effect 生命周期丢弃。 */
function AgentMermaid({ source }: { source: string }): JSX.Element {
  const { t } = useI18n();
  const { resolved_theme } = useAppearance();
  const diagram_id = `agent-mermaid-${useId().replaceAll(":", "")}`;
  const theme_mode = resolved_theme;
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
      <div className="agent-markdown__diagram-error">
        <p>{t("agent_page.diagram.render_failed")}</p>
        <MermaidSource source={source} />
      </div>
    );
  }
  return (
    <figure
      className="agent-markdown__diagram"
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

/** 从围栏代码元素读取一次显式语言与源码，供标签和 Mermaid 共用。 */
function read_code_block(children: ReactNode): CodeBlock | null {
  if (!isValidElement<CodeElementProps>(children)) return null;
  const language_class = children.props.className
    ?.split(/\s+/u)
    .find((class_name) => class_name.startsWith("language-"));
  const language = language_class?.slice("language-".length) || null;
  return {
    language,
    source: String(children.props.children ?? "").replace(/\n$/u, ""),
  };
}

/** Mermaid 自带渲染队列；这里只应用当前主题，不维护第二套调度状态。 */
async function render_mermaid(
  id: string,
  source: string,
  theme_mode: ResolvedThemeMode,
): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize(build_mermaid_config(theme_mode));
  return (await mermaid.render(id, source)).svg;
}

/** 只从全局设计 token 投影安全主题，图表源码不能覆盖这些宿主约束。 */
function build_mermaid_config(theme_mode: ResolvedThemeMode): MermaidConfig {
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
