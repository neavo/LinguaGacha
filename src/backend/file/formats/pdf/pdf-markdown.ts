import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Element, ElementContent, Root } from "hast";
import type { Html } from "mdast";
import type { PDFDocument, PDFRegion } from "../../../../shared/pdf";
import { MARKDOWN_CJK, MARKDOWN_MATH, MARKDOWN_ALERT } from "../../../../shared/markdown-plugins";
import { validate_pdf_region } from "./pdf-source";

export type PDFMarkdown = { html: string; images: Map<string, PDFRegion> };

/** 引用只携带原稿身份与区域，所有消费路径共用相同资源边界。 */
function read_image_reference(value: string, source: PDFDocument["source"]): PDFRegion {
  const match = /^pdf-image:([a-f0-9]{64})\/(\d+)\/([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/u.exec(
    value,
  );
  if (!match || match[1] !== source.digest)
    throw new Error("PDF image must reference this source document.");
  const region = {
    page: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
    width: Number(match[5]),
    height: Number(match[6]),
  };
  validate_pdf_region(source, region);
  return region;
}

/** 编译同时执行内容校验，预演、事务提交与输出接受完全相同的 Markdown。 */
export function pdf_markdown(
  markdown: string,
  source: PDFDocument["source"],
  prefix = "",
): PDFMarkdown {
  const images = new Map<string, PDFRegion>();
  let heading = 0; // 沿用段内标题序号锚点，注释标题不占用正文序号。
  const processor = unified()
    .use(remarkParse)
    .use(MARKDOWN_CJK.remarkPluginsBefore)
    .use(remarkGfm)
    .use(MARKDOWN_CJK.remarkPluginsAfter)
    .use([MARKDOWN_MATH.remarkPlugin])
    .use(MARKDOWN_ALERT)
    .use(remarkRehype, {
      clobberPrefix: prefix,
      footnoteLabel: "↩",
      footnoteBackLabel: "↩",
      footnoteLabelProperties: { className: ["footnote-label"] },
      handlers: { html: (_state, node) => ({ type: "text", value: (node as Html).value }) },
    })
    .use(() => (tree: Root) => {
      visit(tree, "element", (node) => {
        if (/^h[1-6]$/u.test(node.tagName) && node.properties.id !== "footnote-label")
          node.properties.id = `${prefix}heading-${++heading}`;
        if (node.properties.id === "footnote-label") node.properties.id = `${prefix}footnote-label`;
        if (node.properties.ariaDescribedBy)
          node.properties.ariaDescribedBy = [`${prefix}footnote-label`];
        if (node.tagName === "a") {
          const url = String(node.properties.href ?? "");
          if (!/^(https?:\/\/|mailto:|#)[^\s]*$/u.test(url))
            throw new Error("Unsupported PDF link.");
          if (url.startsWith("#") && !url.startsWith(`#${prefix}`))
            node.properties.href = `#${prefix}${url.slice(1)}`;
        }
        if (node.tagName === "img") {
          const url = String(node.properties.src);
          const alt = String(node.properties.alt ?? "");
          images.set(url, read_image_reference(url, source));
          const picture: Element = {
            type: "element",
            tagName: "img",
            properties: { ...node.properties },
            children: [],
          };
          node.tagName = "figure";
          node.properties = {};
          node.children = [
            picture,
            ...(alt
              ? [
                  {
                    type: "element" as const,
                    tagName: "figcaption",
                    properties: {},
                    children: [{ type: "text" as const, value: alt }],
                  },
                ]
              : []),
          ];
          // 新建的 img 已校验，跳过子树以免再次包装。
          return "skip";
        }
        return undefined;
      });
      // figure 不能放进 p。按图文顺序拆开，避免 Chromium 修复 HTML 后改变分页。
      visit(tree, "element", (node, index, parent) => {
        if (
          node.tagName !== "p" ||
          !parent ||
          index === undefined ||
          !node.children.some((child) => child.type === "element" && child.tagName === "figure")
        )
          return;
        const blocks: Element[] = [];
        let inline: ElementContent[] = [];
        const flush = () => {
          if (inline.length) blocks.push({ ...node, children: inline });
          inline = [];
        };
        for (const child of node.children) {
          if (child.type === "element" && child.tagName === "figure") {
            flush();
            blocks.push(child);
          } else inline.push(child);
        }
        flush();
        parent.children.splice(index, 1, ...blocks);
        return index + blocks.length;
      });
    })
    .use([MARKDOWN_MATH.rehypePlugin])
    .use(rehypeStringify);
  const result = processor.processSync(markdown);
  // 插件会把公式错误记为消息并输出字面内容；正式译稿必须显式修正错误。
  const failure = result.messages.find((message) => message.source === "rehype-katex");
  if (failure)
    throw new Error(
      `Invalid PDF formula at ${failure.line ?? "?"}:${failure.column ?? "?"}: ${failure.reason}`,
      { cause: failure },
    );
  return { html: String(result), images };
}
