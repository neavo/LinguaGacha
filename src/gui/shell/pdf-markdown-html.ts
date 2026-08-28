import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

const HTML_TAG_PATTERN = /<[^>]*>/gu;

/** 把译后 Markdown 转为无脚本静态 HTML，图片只保留可读替代文本。 */
export function render_pdf_markdown_html(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, preserve_raw_html_text],
      skipHtml: true,
      components: {
        img: ({ alt }) => React.createElement("span", null, alt ?? ""),
      },
      children: markdown,
    }),
  );
}

/** skipHtml 会丢弃整个 raw 节点；先把其中标签剥离为普通文本，再交给它做安全兜底。 */
function preserve_raw_html_text(): (tree: Root) => void {
  return (tree) => {
    visit_nodes(tree.children);
  };
}

function visit_nodes(nodes: RootContent[]): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.type === "html") {
      nodes[index] = { type: "text", value: node.value.replace(HTML_TAG_PATTERN, "") };
      continue;
    }
    if (node !== undefined && "children" in node && Array.isArray(node.children)) {
      visit_nodes(node.children as RootContent[]);
    }
  }
}
