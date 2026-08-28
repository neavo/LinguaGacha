import { fileURLToPath } from "node:url";

import { initSync, processPdf, type PdfProcessResult } from "@firecrawl/pdf-inspector-wasm";
import wasm_asset_url from "@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm?url";

import { AppError } from "../../../../shared/error";
import { default_native_fs } from "../../../../native/native-fs";

export type PdfMarkdownResult = Readonly<{
  markdown: string;
  skipped_pages: readonly number[];
}>;

let initialized = false;

function ensure_pdf_inspector_wasm_initialized(): void {
  if (initialized) return;
  const asset_url = wasm_asset_url.startsWith("/") ? `..${wasm_asset_url}` : wasm_asset_url;
  const wasm_path = fileURLToPath(new URL(asset_url, import.meta.url));
  initSync({ module: default_native_fs.read_file(wasm_path) });
  initialized = true;
}

/** 提取可用页面并跳过需 OCR 页面；完全没有文本时按普通解析失败处理。 */
export function read_pdf_markdown(content: Uint8Array): string {
  return read_pdf_markdown_result(content).markdown;
}

/** 返回译文所需 Markdown 与被跳过的 1-based 页面编号。 */
export function read_pdf_markdown_result(content: Uint8Array): PdfMarkdownResult {
  try {
    ensure_pdf_inspector_wasm_initialized();
  } catch (error) {
    throw new AppError("file.io_failed", { cause: error });
  }

  let result: PdfProcessResult;
  try {
    result = processPdf(content, {
      includePageMarkers: true,
      profile: "fidelity",
    });
  } catch (error) {
    throw map_pdf_inspector_error(error, content);
  }

  const skipped_pages = normalize_page_numbers(result.pagesNeedingOcr);
  const markdown = strip_page_markers(result.markdown ?? "");
  if (markdown.trim() === "" && (skipped_pages.length > 0 || result.pdfType !== "TextBased")) {
    throw new AppError("file.parse_failed", {
      diagnostic_context: {
        format: "PDF",
        reason: "no_extractable_text",
        pdf_type: result.pdfType,
        ...(skipped_pages.length === 0 ? {} : { pages: skipped_pages }),
        pageCount: result.pageCount,
      },
    });
  }
  return { markdown, skipped_pages };
}

function strip_page_markers(markdown: string): string {
  return markdown.replace(/<!--[ \t]*Page[ \t]+\d+[ \t]*-->[ \t]*\r?\n?/giu, "");
}

function normalize_page_numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((page): page is number => Number.isInteger(page) && page > 0)
    .map(Number)
    .sort((left, right) => left - right)
    .filter((page, index, pages) => index === 0 || page !== pages[index - 1]);
}

function map_pdf_inspector_error(error: unknown, content: Uint8Array): AppError {
  const record = typeof error === "object" && error !== null ? error : {};
  const code = "code" in record && typeof record.code === "string" ? record.code : null;
  if (code === "encrypted" || has_pdf_encryption_entry(content)) {
    return new AppError("file.parse_failed", {
      diagnostic_context: { format: "PDF", reason: "encrypted" },
      cause: error,
    });
  }
  if (code === "needsOcr") {
    return new AppError("file.parse_failed", {
      diagnostic_context: { format: "PDF", reason: "no_extractable_text" },
      cause: error,
    });
  }
  const diagnostic_context = code === null ? {} : { pdf_inspector_code: code };
  return new AppError("file.parse_failed", {
    diagnostic_context: { format: "PDF", ...diagnostic_context },
    cause: error,
  });
}

/** 加密标记位于 PDF trailer，避免依赖第三方不公开的错误 message。 */
function has_pdf_encryption_entry(content: Uint8Array): boolean {
  const tail = new TextDecoder("latin1").decode(content.slice(Math.max(0, content.length - 8192)));
  return /\/Encrypt\s+\d+\s+\d+\s+R\b/u.test(tail);
}
