import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";

import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { remarkAlert } from "remark-github-blockquote-alert";
import { escapeText } from "entities";
import { readFileSync } from "node:fs";

const math = createMathPlugin({ singleDollarTextMath: true });

const layout = readFileSync(new URL("./print.css", import.meta.url), "utf8");
let styles;

/** 宿主禁止外部资源，KaTeX 字体与样式按进程内联一次。 */
function print_styles() {
  if (styles !== undefined) return styles;
  const css = new URL("./katex.min.css", import.meta.resolve("katex"));
  const embedded = readFileSync(css, "utf8").replace(
    /src:url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)[^;}]*;?/gu,
    (_declaration, name) => {
      const data = readFileSync(new URL(name, css)).toString("base64");
      return `src:url(data:font/woff2;base64,${data}) format("woff2");`;
    },
  );
  styles = `${embedded}\n${layout}`;
  return styles;
}

/** 解析引用并核对原稿摘要。区域边界在 MuPDF 渲染时统一检查。 */
function read_image_reference(value, digest) {
  const match = /^pdf-image:([a-f0-9]{64})\/(\d+)\/([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/u.exec(
    value,
  );
  if (!match || match[1] !== digest)
    throw new Error("PDF image must reference this source document.");
  return {
    page: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
    width: Number(match[5]),
    height: Number(match[6]),
  };
}

/** 编译 Markdown 并收集嵌图引用。每个原页的标题和脚注拥有独立锚点。 */
function pdf_markdown(markdown, digest, prefix) {
  const images = new Map();
  let heading = 0; // 沿用页内标题序号锚点，注释标题不占用正文序号。
  const processor = unified()
    .use(remarkParse)
    .use(cjk.remarkPluginsBefore)
    .use(remarkGfm)
    .use(cjk.remarkPluginsAfter)
    .use([math.remarkPlugin])
    .use(remarkAlert)
    .use(remarkRehype, {
      clobberPrefix: prefix,
      footnoteLabel: "↩",
      footnoteBackLabel: "↩",
      footnoteLabelProperties: { className: ["footnote-label"] },
      handlers: { html: (_state, node) => ({ type: "text", value: node.value }) },
    })
    .use(() => (tree) => {
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
          images.set(url, read_image_reference(url, digest));
          const picture = {
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
                    type: "element",
                    tagName: "figcaption",
                    properties: {},
                    children: [{ type: "text", value: alt }],
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
        const blocks = [];
        let inline = [];
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
    .use([math.rehypePlugin])
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

/** 独立编译本页正文和引用，空译稿可接管原页而不生成正文。 */
function render_pdf_page_translation(page, digest) {
  const translation = page.translation;
  if (translation?.kind !== "translate" || !translation.markdown.trim()) return null;
  try {
    return pdf_markdown(translation.markdown, digest, `page-${page.page}-`);
  } catch (error) {
    throw new Error(
      `PDF page ${page.page}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** 预览和导出共用页级校验，空渲染结果交给构建入口表达无产物。 */
export function render_pdf_translation(pages, digest) {
  return pages.map((page) => render_pdf_page_translation(page, digest));
}

/** 正文按原稿可见尺寸打印；宿主提供正文字体，KaTeX 样式随正文内联。 */
export function render_pdf_html(args) {
  const source_html = args.rendered.map((entry) => entry.html).join("\n");
  const images = new Map(args.rendered.flatMap((entry) => [...entry.images]));
  const image_data = new Map();
  for (const [reference, region] of images) {
    const bytes = args.renderImage(region);
    image_data.set(reference, `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  }
  // 只扫描原始 HTML，避免后续替换反复遍历已内嵌的 Base64 数据。
  const html = source_html.replace(/src="(pdf-image:[^"]+)"/g, (attribute, reference) => {
    const data = image_data.get(reference);
    return data === undefined ? attribute : `src="${data}"`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(args.title)}</title><style>${print_styles()}\n@page { size:${args.size.width}pt ${args.size.height}pt; } body { --pdf-page-height:${args.size.height}pt; }</style></head><body class="pdf-document">${html}</body></html>`;
}
