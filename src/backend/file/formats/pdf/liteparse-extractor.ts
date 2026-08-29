import { LiteParse, type LayoutBlock, type ParseResult } from "@llamaindex/liteparse";

import { AppError } from "../../../../shared/error";
import type {
  PdfBbox,
  PdfRawBlock,
  PdfRawCell,
  PdfRawDocument,
  PdfRawPage,
} from "./pdf-semantic-types";

let parser: LiteParse | undefined;

/** 在进程内复用原生解析器，避免每次读取重复加载 PDFium。 */
function get_parser(): LiteParse {
  return (parser ??= new LiteParse({
    outputFormat: "json",
    extractBlocks: true,
    keepHeadersFooters: false,
    imageMode: "off",
    extractImages: false,
    extractLinks: true,
    ocrEnabled: false,
    // 保留可读页面；失败页不阻塞混合 PDF 导入。
    continueOnPageError: true,
    quiet: true,
  }));
}

/** LiteParse 的唯一生产边界；其余 PDF 代码只接触项目自己的 raw 类型。 */
export async function extract_pdf_raw_document(content: Uint8Array): Promise<PdfRawDocument> {
  let active_parser: LiteParse;
  try {
    active_parser = get_parser();
  } catch (error) {
    throw new AppError("file.io_failed", { cause: error, diagnostic_context: { format: "PDF" } });
  }
  let result: ParseResult;
  try {
    result = await active_parser.parse(content);
  } catch (error) {
    throw map_parse_error(error, content);
  }
  const pages = result.pages.map((page) => map_page(page));
  if (result.totalPages === 0 || pages.every((page) => page.blocks.length === 0)) {
    throw new AppError("file.parse_failed", {
      diagnostic_context: {
        format: "PDF",
        reason: "no_extractable_text",
        pageCount: result.totalPages,
      },
    });
  }
  return { pages };
}

/** 将 LiteParse 页面投影为不泄漏第三方类型的 raw 页面。 */
function map_page(page: ParseResult["pages"][number]): PdfRawPage {
  const blocks = (page.blocks ?? [])
    .map(map_block)
    .filter((block): block is PdfRawBlock => block !== null);
  if (blocks.length === 0 && page.text.trim() !== "") {
    blocks.push({ kind: "paragraph", text: page.text, bbox: undefined });
  }
  return {
    page_number: page.pageNum,
    width: page.width,
    height: page.height,
    blocks,
  };
}

/** 只在此处处理第三方 block 联合类型，其余阶段使用项目自有 kind。 */
function map_block(block: LayoutBlock): PdfRawBlock | null {
  const bbox = block.bbox ? to_bbox(block.bbox) : undefined;
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "list_item":
      return {
        kind: block.kind,
        text: block.text ?? block.lines?.join(" ") ?? "",
        level: block.level,
        ordered: block.ordered,
        marker: block.marker,
        bbox,
      };
    case "table":
    case "grid_fallback":
      return {
        kind: block.kind,
        header: (block.header ?? []).map(map_cell),
        rows: (block.rows ?? []).map((row) => row.map(map_cell)),
        text: block.lines?.join("\n"),
        lines: block.lines,
        bbox,
      };
    case "figure":
      return { kind: "figure", bbox };
    case "rule":
      return { kind: "rule", bbox };
    case "code":
      return { kind: "paragraph", text: block.lines?.join("\n") ?? block.text ?? "", bbox };
    default:
      return null;
  }
}

function map_cell(cell: { text: string }): PdfRawCell {
  return { text: cell.text };
}

function to_bbox(value: { x: number; y: number; width: number; height: number }): PdfBbox {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

/** 仅依据 PDF trailer 的结构化加密标记分类，避免读取异常文本建立控制流。 */
function map_parse_error(error: unknown, content: Uint8Array): AppError {
  const encrypted = /\/Encrypt\s+\d+\s+\d+\s+R\b/u.test(
    new TextDecoder("latin1").decode(content.slice(Math.max(0, content.length - 8192))),
  );
  if (encrypted) {
    return new AppError("file.parse_failed", {
      diagnostic_context: { format: "PDF", reason: "encrypted" },
      cause: error,
    });
  }
  return new AppError("file.parse_failed", {
    diagnostic_context: { format: "PDF", reason: "parse_error" },
    cause: error,
  });
}
