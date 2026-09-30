import { useDevicePixelRatio } from "@frontend/widgets/interactions/use-device-pixel-ratio";
import {
  type JSX,
  memo,
  useEffect,
  useMemo,
  useRef,
  useContext,
  useState,
  type ComponentProps,
  type WheelEvent,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { code } from "@streamdown/code";
import { MARKDOWN_CJK, MARKDOWN_MATH, MARKDOWN_ALERT } from "@shared/markdown-plugins";
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

import { useAppearance } from "@frontend/app/appearance/appearance-context";
import { api_blob } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import { resolve_agent_workspace_href } from "@shared/agent-workspace-file";
import { AgentMarkdownLink } from "./agent-markdown-link";
import { AgentFileContext, AgentMarkdownPathContext } from "./agent-file-context";
import type { Heading, Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";
import { AgentFileTrigger } from "./agent-file-trigger";

import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import "./agent-markdown.css";

type AgentMarkdownProps = {
  text: string;
  streaming: boolean;
  document_path?: string;
};

const MARKDOWN_DIAGRAM_OPTIONS = { errorComponent: AgentMarkdownDiagramError };
const MARKDOWN_CONTROLS = { mermaid: { fullscreen: false } };
// 保留产品的原始 HTML 展示；URL 在唯一转换入口沿用既有协议边界。
const MARKDOWN_REHYPE_PLUGINS = [defaultRehypePlugins.raw!]; // Streamdown 的 raw 插件是产品保留原始 HTML 的固定依赖。
const MARKDOWN_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), MARKDOWN_ALERT];
const DOCUMENT_REMARK_PLUGINS = [...MARKDOWN_REMARK_PLUGINS, agent_document_headings];
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
  a: AgentMarkdownLink,
  img: AgentMarkdownImage,
  table: AgentMarkdownTable,
};

/** Streamdown 拥有流式语义、高亮和图表；本入口组装产品排版与桌面交互。 */
export const AgentMarkdown = memo(function AgentMarkdown(props: AgentMarkdownProps): JSX.Element {
  const { t } = useI18n();
  const { resolved_theme, font_size_preference } = useAppearance();

  const markdown_ref = useRef<HTMLDivElement>(null);
  const [diagram_config, set_diagram_config] = useState<MermaidConfig>(() => ({
    theme: resolved_theme === "dark" ? "dark" : "default",
  }));
  // 等待外观投影生效，再读取配色和正文实际字号供图表布局使用。
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (markdown_ref.current) {
        set_diagram_config(
          build_mermaid_config(resolved_theme, getComputedStyle(markdown_ref.current).fontSize),
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [resolved_theme, font_size_preference]);
  // 配置由插件实例拥有；主题改变通过公开 plugins 身份通知 Streamdown。
  const plugins = useMemo(
    () => ({
      code,
      cjk: MARKDOWN_CJK,
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
    zoomIn: t("app.media.zoom_in"),
    zoomOut: t("app.media.zoom_out"),
    resetView: t("app.media.reset_zoom"),
  };

  return (
    <AgentMarkdownPathContext value={props.document_path ?? ""}>
      <div
        ref={markdown_ref}
        className="agent-markdown"
        onWheelCapture={scroll_past_inline_diagram}
        onPointerDownCapture={focus_inline_diagram}
        onKeyDownCapture={leave_inline_diagram}
      >
        {/* 关闭默认块间距，避免原始 HTML 块额外叠加留白。 */}
        <Streamdown
          className="agent-markdown__content space-y-0"
          // 文档一次解析完整语法树，使重复标题和引用定义在整篇内共享作用域。
          mode={props.document_path ? "static" : "streaming"}
          isAnimating={props.streaming}
          parseIncompleteMarkdown={props.streaming}
          plugins={plugins}
          components={MARKDOWN_COMPONENTS}
          rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
          remarkPlugins={props.document_path ? DOCUMENT_REMARK_PLUGINS : MARKDOWN_REMARK_PLUGINS}
          urlTransform={filter_markdown_url}
          mermaid={MARKDOWN_DIAGRAM_OPTIONS}
          translations={translations}
          controls={MARKDOWN_CONTROLS}
          codeBlockMaxHeight={0}
        >
          {props.text}
        </Streamdown>
      </div>
    </AgentMarkdownPathContext>
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
function build_mermaid_config(theme: "light" | "dark", font_size: string): MermaidConfig {
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
      fontSize: font_size,
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

/** 工作区图片共用文件入口，其它来源只保留内联展示。 */
function AgentMarkdownImage({
  node: _node,
  src,
  alt,
  title,
  ...props
}: ComponentProps<"img"> & ExtraProps): JSX.Element | null {
  const { t } = useI18n();
  const pixel_ratio = useDevicePixelRatio();
  const [intrinsic, set_intrinsic] = useState({ source: "", width: 0 });
  const base_path = useContext(AgentMarkdownPathContext);
  const documents = useContext(AgentFileContext);
  const [local_source, set_local_source] = useState<{
    source: string;
    url: string;
    mime: string;
  } | null>(null);
  const relative = typeof src === "string" && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(src);
  const session_id = documents?.session_id;
  useEffect(() => {
    if (!relative || !src || !session_id) return;
    const controller = new AbortController();
    let url: string | null = null;
    void (async () => {
      const path = resolve_agent_workspace_href(src, base_path);
      const query = new URLSearchParams({ path, sessionId: session_id });
      const blob = await api_blob(`/api/agent/workspace/image?${query}`, controller.signal);
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      set_local_source({ source: src, url, mime: blob.type });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("agent_page.document.read_failed")),
        );
    });
    return () => {
      controller.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [base_path, relative, session_id, src, t]);
  if (!src) return null;
  const source =
    relative && session_id ? (local_source?.source === src ? local_source.url : undefined) : src;
  const label = alt?.trim() || title?.trim() || t("agent_page.image.title");
  // 只限制有 MIME 依据且未指定排版尺寸的位图；矢量图与作者尺寸保留 CSS 语义。
  const actual_width =
    local_source?.source === src &&
    local_source.mime.startsWith("image/") &&
    local_source.mime !== "image/svg+xml" &&
    intrinsic.source === source &&
    props.width === undefined &&
    props.height === undefined &&
    props.style?.width === undefined &&
    props.style?.height === undefined
      ? intrinsic.width / pixel_ratio
      : undefined;
  const image = (
    <img
      {...props}
      src={source}
      style={{
        ...(props.height === undefined ? {} : { height: `${props.height}px` }),
        ...props.style,
        ...(actual_width === undefined
          ? {}
          : { width: actual_width, maxWidth: props.style?.maxWidth ?? "100%" }),
      }}
      onLoad={(event) => {
        set_intrinsic({ source: source ?? "", width: event.currentTarget.naturalWidth });
        props.onLoad?.(event);
      }}
      alt={label}
      title={title}
      loading={props.loading ?? "lazy"}
      decoding={props.decoding ?? "async"}
    />
  );
  if (relative && documents && typeof src === "string") {
    const path = resolve_agent_workspace_href(src, base_path);
    return (
      <AgentFileTrigger
        path={path}
        render={
          <button type="button" className="agent-markdown__image-trigger" aria-label={label} />
        }
      >
        {image}
      </AgentFileTrigger>
    );
  }
  return image;
}

/** 文档标题生成稳定的页内锚点；作用域由每份文档的面板限定。 */
function agent_document_headings(): (tree: Root) => void {
  return (tree) => {
    const used = new Set<string>();
    visit(tree, "heading", (node: Heading) => {
      const base = heading_text(node)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
        .replace(/\s/gu, "-");
      let id = base;
      let index = 0;
      while (used.has(id)) id = `${base}-${++index}`;
      used.add(id);
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
    });
  };
}

/** 提取标题内的文字、行内代码和图片替代文本，生成可链接的标识。 */
function heading_text(node: RootContent): string {
  if ("value" in node) return node.value;
  if ("alt" in node) return node.alt ?? "";
  if ("children" in node) return node.children.map(heading_text).join("");
  return "";
}
