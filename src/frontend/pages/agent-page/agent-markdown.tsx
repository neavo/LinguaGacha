import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type WheelEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { remarkAlert } from "remark-github-blockquote-alert";
import { createMermaidPlugin, type MermaidConfig } from "@streamdown/mermaid";
import {
  Streamdown,
  TableDownloadDropdown,
  TableCopyDropdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type Components,
  type ExtraProps,
  type MermaidErrorComponentProps,
  type StreamdownTranslations,
} from "streamdown";

import { useAppearance } from "@frontend/app/appearance/appearance-provider";
import { open_external_url, api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type { AgentWorkspaceLinkResult } from "@shared/agent";
import { AgentMediaPreviewDialog } from "./agent-media-preview-dialog";

import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import "./agent-markdown.css";

type AgentMarkdownProps = {
  text: string;
  streaming: boolean;
  annotatable?: boolean;
};

const MARKDOWN_DIAGRAM_OPTIONS = { errorComponent: AgentMarkdownDiagramError };
const MARKDOWN_CONTROLS = { mermaid: { fullscreen: false } };
// 保留产品的原始 HTML 展示；URL 在唯一转换入口沿用既有协议边界。
const MARKDOWN_REHYPE_PLUGINS = [defaultRehypePlugins.raw];
const MARKDOWN_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkAlert];
const MARKDOWN_MATH = createMathPlugin({ singleDollarTextMath: true });
const MARKDOWN_URL_PROTOCOL = /^(?:https?|ircs?|mailto|xmpp)$/iu;
const MERMAID_NODE_RADIUS = 4;
const MERMAID_EDGE_LABEL_RADIUS = 3;
// 节点和连线几何不在 Mermaid 主题变量中，通过官方 themeCSS 保留应用图表样式。
const MERMAID_THEME_CSS = `
  .node rect.basic.label-container,
  .cluster rect {
    rx: ${MERMAID_NODE_RADIUS}px;
    ry: ${MERMAID_NODE_RADIUS}px;
  }
  .edgePath .path,
  .flowchart-link {
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .edgeLabel rect {
    rx: ${MERMAID_EDGE_LABEL_RADIUS}px;
    ry: ${MERMAID_EDGE_LABEL_RADIUS}px;
  }
`;
// 普通正文使用原生标签，让产品 CSS 独立拥有排版；稳定映射避免流式更新重挂交互组件。
const MARKDOWN_COMPONENTS: Components = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  hr: "hr",
  strong: "strong",
  a: ({ node: _node, href, children, ...props }) =>
    href ? (
      <a {...props} href={href}>
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: AgentMarkdownImage,
  table: AgentMarkdownTable,
};

/** Streamdown 拥有流式语义、高亮和图表；本入口组装产品排版与桌面交互。 */
export const AgentMarkdown = memo(function AgentMarkdown(props: AgentMarkdownProps): JSX.Element {
  const { t } = useI18n();
  const { resolved_theme } = useAppearance();
  const { push_toast } = useDesktopToast();
  const pending_links = useRef(new Set<string>()); // 同正文的重复链接共用待决状态
  const [diagram_config, set_diagram_config] = useState<MermaidConfig>(() => ({
    theme: resolved_theme === "dark" ? "dark" : "default",
  }));
  // next-themes 在 effect 中写入根节点主题，下一帧读取已生效的 CSS 令牌。
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      set_diagram_config(build_mermaid_config(resolved_theme)),
    );
    return () => cancelAnimationFrame(frame);
  }, [resolved_theme]);
  // 配置由插件实例拥有；主题改变通过公开 plugins 身份通知 Streamdown。
  const plugins = useMemo(
    () => ({
      code,
      cjk,
      math: MARKDOWN_MATH,
      mermaid: createMermaidPlugin({ config: diagram_config }),
    }),
    [diagram_config],
  );
  const translations: Partial<StreamdownTranslations> = {
    copied: t("agent_page.action.copied"),
    copyCode: t("agent_page.markdown.copy_code"),
    downloadFile: t("agent_page.markdown.download_code"),
    copyTable: t("agent_page.markdown.copy_table"),
    copyTableAsCsv: t("agent_page.markdown.copy_format", { format: "CSV" }),
    copyTableAsMarkdown: t("agent_page.markdown.copy_format", { format: "Markdown" }),
    copyTableAsTsv: t("agent_page.markdown.copy_format", { format: "TSV" }),
    downloadTable: t("agent_page.markdown.download_table"),
    downloadTableAsCsv: t("agent_page.markdown.download_format", { format: "CSV" }),
    downloadTableAsMarkdown: t("agent_page.markdown.download_format", { format: "Markdown" }),
    downloadDiagram: t("agent_page.markdown.download_diagram"),
    downloadDiagramAsMmd: t("agent_page.markdown.download_format", { format: "Mermaid" }),
    downloadDiagramAsPng: t("agent_page.markdown.download_format", { format: "PNG" }),
    downloadDiagramAsSvg: t("agent_page.markdown.download_format", { format: "SVG" }),
    zoomIn: t("agent_page.media.zoom_in"),
    zoomOut: t("agent_page.media.zoom_out"),
    resetView: t("agent_page.media.reset_zoom"),
  };

  /** 事件委托保留组件映射身份；读取属性原值，避免相对工作区路径变为后端 URL。 */
  const activate_link = async (event: MouseEvent<HTMLDivElement>): Promise<void> => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href || href.startsWith("#") || !event.currentTarget.contains(anchor)) return;
    event.preventDefault();
    if (pending_links.current.has(href)) return;
    pending_links.current.add(href);
    try {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href)) {
        await open_external_url(href.startsWith("//") ? `https:${href}` : href);
      } else {
        const result = await api_fetch<AgentWorkspaceLinkResult>(
          "/api/agent/workspace/activate-path",
          { path: href },
        );
        if (result.status === "saved") push_toast("success", t("agent_page.file_saved"));
      }
    } catch (error: unknown) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("agent_page.error.activate_link")),
      );
    } finally {
      pending_links.current.delete(href);
    }
  };

  return (
    <div
      className="agent-markdown"
      data-agent-annotation-content={props.annotatable || undefined}
      onClick={activate_link}
      onWheelCapture={scroll_past_inline_diagram}
      onPointerDownCapture={focus_inline_diagram}
      onKeyDownCapture={leave_inline_diagram}
    >
      {/* 关闭默认块间距，避免原始 HTML 块额外叠加留白。 */}
      <Streamdown
        className="agent-markdown__content space-y-0"
        isAnimating={props.streaming}
        parseIncompleteMarkdown={props.streaming}
        plugins={plugins}
        components={MARKDOWN_COMPONENTS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        urlTransform={filter_markdown_url}
        mermaid={MARKDOWN_DIAGRAM_OPTIONS}
        translations={translations}
        controls={MARKDOWN_CONTROLS}
        codeBlockMaxHeight={0}
      >
        {props.text}
      </Streamdown>
    </div>
  );
});

/** 滚轮只交给当前拥有焦点的图表，其余位置保留浏览器的信息流滚动。 */
function scroll_past_inline_diagram(event: WheelEvent<HTMLDivElement>): void {
  const target = event.target;
  const diagram = target instanceof Element ? target.closest('[data-streamdown="mermaid"]') : null;
  if (diagram && !diagram.contains(document.activeElement)) {
    event.stopPropagation();
  }
}

/** 画布点击使用真实 DOM 焦点；按钮继续使用浏览器自身的焦点和点击行为。 */
function focus_inline_diagram(event: PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const diagram = event.target.closest<HTMLElement>('[data-streamdown="mermaid"]');
  if (!diagram) return;
  const selection = window.getSelection();
  if (
    selection &&
    diagram.contains(selection.anchorNode) &&
    diagram.contains(selection.focusNode)
  ) {
    selection.removeAllRanges();
  }
  if (!event.target.closest("button")) {
    diagram.tabIndex = -1;
    diagram.focus({ preventScroll: true });
  }
}

/** Escape 退出图表操作模式，下一次滚轮恢复页面滚动。 */
function leave_inline_diagram(event: KeyboardEvent<HTMLDivElement>): void {
  const active = document.activeElement;
  if (
    event.key === "Escape" &&
    active instanceof HTMLElement &&
    active.closest('[data-streamdown="mermaid"]')
  ) {
    active.blur();
    event.stopPropagation();
  }
}

/** 调整真实 DOM 顺序，让键盘导航与“下载 → 复制”的视觉顺序一致。 */
function AgentMarkdownTable({
  node: _node,
  children,
  ...props
}: ComponentProps<"table"> & ExtraProps): JSX.Element {
  return (
    <div data-streamdown="table-wrapper">
      <div className="flex items-center justify-end gap-1">
        <TableDownloadDropdown />
        <TableCopyDropdown />
      </div>
      <div className="overflow-x-auto">
        <table {...props} data-streamdown="table">
          {children}
        </table>
      </div>
    </div>
  );
}

/** 与原 Markdown URL 规则一致：相对目标保留，协议目标仅接受既有公开协议。 */
function filter_markdown_url(value: string): string {
  const colon = value.indexOf(":");
  if (
    colon === -1 ||
    ["/", "?", "#"].some((separator) => {
      const index = value.indexOf(separator);
      return index !== -1 && index < colon;
    }) ||
    MARKDOWN_URL_PROTOCOL.test(value.slice(0, colon))
  )
    return value;
  return "";
}

/** 图表配色消费应用令牌，实例、缓存与渲染生命周期归官方插件。 */
function build_mermaid_config(theme: "light" | "dark"): MermaidConfig {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    theme: "base",
    fontFamily: "var(--ui-font-family-base)",
    themeCSS: MERMAID_THEME_CSS,
    flowchart: { curve: "rounded" },
    themeVariables: {
      darkMode: theme === "dark",
      background: token("--popover"),
      primaryColor: token("--popover"),
      primaryTextColor: token("--foreground"),
      primaryBorderColor: token("--border"),
      secondaryColor: token("--accent"),
      tertiaryColor: token("--secondary"),
      lineColor: token("--muted-foreground"),
      arrowheadColor: token("--muted-foreground"),
      clusterBkg: token("--background"),
      clusterBorderColor: token("--border"),
      edgeLabelBackground: token("--background"),
      titleColor: token("--foreground"),
      strokeWidth: 1,
      fontFamily: "var(--ui-font-family-base)",
      fontSize: "13px",
    },
  };
}

/** 失败反馈使用产品文案，模型源码保留为可选择的原始文本。 */
function AgentMarkdownDiagramError({ chart }: MermaidErrorComponentProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="agent-markdown__diagram-error">
      <p>{t("agent_page.diagram.render_failed")}</p>
      <pre>
        <code>{chart}</code>
      </pre>
    </div>
  );
}

/** 图片继续复用附件的媒体预览；组件身份不随流式正文追加而变化。 */
function AgentMarkdownImage({
  node: _node,
  src,
  alt,
  title,
  ...props
}: ComponentProps<"img"> & ExtraProps): JSX.Element | null {
  const { t } = useI18n();
  const [open, set_open] = useState(false);
  if (!src) return null;
  const label = alt?.trim() || title?.trim() || t("agent_page.image.title");
  return (
    <>
      <button
        type="button"
        className="agent-markdown__image-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        title={t("agent_page.image.open_preview")}
        onClick={() => set_open(true)}
      >
        <img
          {...props}
          src={src}
          alt={label}
          title={title}
          loading={props.loading ?? "lazy"}
          decoding={props.decoding ?? "async"}
        />
      </button>
      <AgentMediaPreviewDialog open={open} title={label} onClose={() => set_open(false)}>
        <img src={src} alt={label} decoding="async" />
      </AgentMediaPreviewDialog>
    </>
  );
}
