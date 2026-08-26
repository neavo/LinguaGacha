import {
  isValidElement,
  memo,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { AgentMediaPreviewDialog } from "./agent-media-preview-dialog";
import { AgentMermaidBlock } from "./agent-mermaid";

import "./agent-markdown.css";

type AgentMarkdownProps = {
  text: string;
  streaming: boolean;
  annotatable?: boolean;
};

type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

type CodeBlock = {
  language: string | null;
  source: string;
};

/** 渲染 Agent 正文 Markdown；图表仅在完整消息内进入 Mermaid 异步边界。 */
export const AgentMarkdown = memo(function AgentMarkdown(props: AgentMarkdownProps): JSX.Element {
  const { t } = useI18n();
  // Markdown 只接管外链、图片预览与 Mermaid，其余 HTML 沿用标准渲染链。
  const components = useMemo<Components>(
    () => ({
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
      pre: ({ node: _node, children, ...pre_props }) => {
        const code_block = read_code_block(children);
        if (!props.streaming && code_block?.language === "mermaid") {
          return <AgentMermaidBlock source={code_block.source} />;
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
      img: ({ node: _node, src, alt, title, ...img_props }) => {
        if (src === undefined) return null;
        const label = alt?.trim() || title?.trim() || t("agent_page.image.title");
        return <AgentMarkdownImage src={src} alt={label} image_props={img_props} />;
      },
    }),
    [props.streaming, t],
  );

  return (
    <div className="agent-markdown" data-agent-annotation-content={props.annotatable || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={
          props.streaming
            ? [rehypeRaw]
            : [rehypeRaw, [rehypeHighlight, { detect: false, plainText: ["mermaid"] }]]
        }
        components={components}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}, agent_markdown_props_equal);

function agent_markdown_props_equal(
  previous: AgentMarkdownProps,
  next: AgentMarkdownProps,
): boolean {
  return (
    previous.text === next.text &&
    previous.streaming === next.streaming &&
    previous.annotatable === next.annotatable
  );
}

/** 把 Markdown 图片投影为可访问的内嵌预览入口。 */
function AgentMarkdownImage(props: {
  src: string;
  alt: string;
  image_props: ImgHTMLAttributes<HTMLImageElement>;
}): JSX.Element {
  const { t } = useI18n();
  const [open, set_open] = useState(false);
  return (
    <>
      <button
        type="button"
        className="agent-markdown__image-trigger"
        aria-label={props.alt}
        aria-haspopup="dialog"
        title={t("agent_page.image.open_preview")}
        onClick={() => set_open(true)}
      >
        <img
          {...props.image_props}
          src={props.src}
          alt={props.alt}
          loading={props.image_props.loading ?? "lazy"}
          decoding={props.image_props.decoding ?? "async"}
        />
      </button>
      <AgentMediaPreviewDialog open={open} title={props.alt} onClose={() => set_open(false)}>
        <img src={props.src} alt={props.alt} decoding="async" />
      </AgentMediaPreviewDialog>
    </>
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
