import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent } from "mdast";
import { Check } from "typebox/value";
import type { PDFDocument, PDFTranslation, PDFRegion } from "../../../../shared/pdf";
import { PDF_TRANSLATION_SCHEMA, validate_pdf_region } from "./pdf-source";

const markdown = unified().use(remarkParse).use(remarkGfm);
/** Markdown 原文和属性值共用转义，模板只接收已处理的内容。 */
const escape_html = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
type Node = Root | RootContent | PhrasingContent;

/** 图片引用只携带原稿身份和坐标，范围随后按当前文档校验。 */
function parse_pdf_image_reference(value: string): { digest: string; region: PDFRegion } | null {
  const match = /^pdf-image:([a-f0-9]{64})\/(\d+)\/([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/u.exec(
    value,
  );
  if (!match) return null;
  const [, digest, page, x, y, width, height] = match;
  return {
    digest: digest!,
    region: {
      page: Number(page),
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    },
  };
}

/** 预览、提交校验和正式输出共用相同语法边界，HTML 和资源地址始终由应用构建。 */
export function pdf_markdown(
  markdown_text: string,
  source_data: PDFDocument["source"],
  anchor_prefix = "",
): { html: string; images: Map<string, PDFRegion> } {
  const root = markdown.parse(markdown_text);
  const images = new Map<string, PDFRegion>();
  const definitions = new Map(
    root.children.flatMap((node) =>
      node.type === "definition" ? [[node.identifier, node] as const] : [],
    ),
  );
  const link = (url: string, content: string): string => {
    if (!/^(https?:\/\/|mailto:|#)[^\s]*$/u.test(url)) throw new Error("Unsupported PDF link.");
    return `<a href="${escape_html(url.startsWith("#") ? `#${anchor_prefix}${url.slice(1)}` : url)}">${content}</a>`;
  };
  const picture = (url: string, alt: string): string => {
    const source = parse_pdf_image_reference(url);
    if (!source || source.digest !== source_data.digest)
      throw new Error("PDF image must reference this source document.");
    validate_pdf_region(source_data, source.region);
    images.set(url, source.region);
    return `<figure><img src="${escape_html(url)}" alt="${escape_html(alt)}">${alt ? `<figcaption>${escape_html(alt)}</figcaption>` : ""}</figure>`;
  };
  let heading_number = 0;
  const render = (node: Node): string => {
    const children = () =>
      "children" in node ? node.children.map((child) => render(child as Node)).join("") : "";
    switch (node.type) {
      case "root":
        return children();
      case "html":
      // 保留原始标签与注释的字面内容，输出始终由应用控制。
      case "text":
        return escape_html(node.value);
      case "paragraph": {
        // figure 是块元素。放进 p 会被 Chromium 修复成空段落，破坏标题与图片的分页约束。
        let html = "";
        let inline = "";
        const flush = () => {
          if (inline !== "") html += `<p>${inline}</p>`;
          inline = "";
        };
        for (const child of node.children) {
          if (child.type === "image" || child.type === "imageReference") {
            flush();
            html += render(child);
          } else inline += render(child);
        }
        flush();
        return html;
      }
      case "heading":
        return `<h${node.depth} id="${anchor_prefix}heading-${++heading_number}">${children()}</h${node.depth}>`;
      case "strong":
        return `<strong>${children()}</strong>`;
      case "emphasis":
        return `<em>${children()}</em>`;
      case "delete":
        return `<del>${children()}</del>`;
      case "blockquote":
        return `<blockquote>${children()}</blockquote>`;
      case "list":
        return node.ordered
          ? `<ol start="${node.start ?? 1}">${children()}</ol>`
          : `<ul>${children()}</ul>`;
      case "listItem":
        return `<li>${children()}</li>`;
      case "code":
        return `<pre><code>${escape_html(node.value)}</code></pre>`;
      case "inlineCode":
        return `<code>${escape_html(node.value)}</code>`;
      case "break":
        return "<br>";
      case "thematicBreak":
        return "<hr>";
      case "link":
        return link(node.url, children());
      case "image":
        return picture(node.url, node.alt ?? "");
      case "linkReference":
      case "imageReference": {
        const definition = definitions.get(node.identifier);
        if (!definition) throw new Error("Missing Markdown reference.");
        return node.type === "imageReference"
          ? picture(definition.url, node.alt ?? "")
          : link(definition.url, children());
      }
      case "definition":
        return "";
      case "table":
        return `<table><thead>${node.children
          .slice(0, 1)
          .map(
            (row) =>
              `<tr>${row.children.map((cell) => `<th>${cell.children.map(render).join("")}</th>`).join("")}</tr>`,
          )
          .join("")}</thead><tbody>${node.children.slice(1).map(render).join("")}</tbody></table>`;
      case "tableRow":
        return `<tr>${children()}</tr>`;
      case "tableCell":
        return `<td>${children()}</td>`;
      default:
        throw new Error(`Unsupported PDF Markdown node: ${node.type}`);
    }
  };
  return { html: render(root), images };
}

/** 校验范围并渲染各段，提交与输出共用内容规则；核对记录只表达原页检查情况。 */
export function render_pdf_translation(
  translation: PDFTranslation,
  source: PDFDocument["source"],
): ReturnType<typeof pdf_markdown>[] {
  if (!Check(PDF_TRANSLATION_SCHEMA, translation)) throw new Error("Invalid PDF translation.");
  if (translation.reviewed_pages.some((page) => page > source.pages.length))
    throw new Error("Reviewed page is outside the source document.");
  let previous_end = 0;
  return translation.sections.map((section) => {
    if (
      section.page_start <= previous_end ||
      section.page_end < section.page_start ||
      section.page_end > source.pages.length
    )
      throw new Error(
        "PDF translation ranges must be ordered, disjoint and inside the source document.",
      );
    if (section.markdown.trim() === "")
      throw new Error("PDF translation section must contain text.");
    previous_end = section.page_end;
    return pdf_markdown(section.markdown, source, `page-${section.page_start}-`);
  });
}

/** 每段 Markdown 独立解析引用，再将相邻译稿合入同一排版模板。 */
export async function render_pdf_html(args: {
  title: string;
  rendered: readonly ReturnType<typeof pdf_markdown>[];
  renderImage: (region: PDFRegion) => Promise<Uint8Array>;
}): Promise<string> {
  let html = args.rendered.map((entry) => entry.html).join("\n");
  const images = new Map(args.rendered.flatMap((entry) => [...entry.images]));
  for (const [reference, region] of images) {
    const bytes = await args.renderImage(region);
    html = html.replaceAll(
      `src="${escape_html(reference)}"`,
      `src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}"`,
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape_html(args.title)}</title><style>
  @page { size:A4; margin:20mm 18mm; }
  body { font-family:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif; color:#20242b; font-size:11pt; line-height:1.7; overflow-wrap:anywhere; }
  h1,h2,h3,h4,h5,h6 { line-height:1.35; break-after:avoid; color:#13253d; margin:1.25em 0 .55em; }
  h1 { font-size:23pt; } h2 { font-size:17pt; } h3 { font-size:13pt; }
  p { margin:.65em 0; orphans:3; widows:3; } blockquote { border-left:3px solid #a8b8cb; margin:1em 0; padding-left:1em; }
  table { border-collapse:collapse; width:100%; font-size:9.5pt; margin:1em 0; table-layout:fixed; } thead { display:table-header-group; }
  th,td { border:1px solid #bdc7d2; padding:6px 8px; vertical-align:top; } th { background:#eef2f6; text-align:left; } tr { break-inside:avoid; }
  figure { margin:1em 0; text-align:center; break-inside:avoid; } img { max-width:100%; max-height:230mm; object-fit:contain; } figcaption { font-size:9pt; color:#4d5d70; }
  pre { white-space:pre-wrap; background:#f1f3f6; padding:10px; } code { font-family:Consolas,monospace; } a { color:#245a91; }
  </style></head><body>${html}</body></html>`;
}
