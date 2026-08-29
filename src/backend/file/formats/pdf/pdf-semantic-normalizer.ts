import type {
  PdfBbox,
  PdfRawBlock,
  PdfRawDocument,
  PdfRawPage,
  PdfSemanticBlock,
  PdfSemanticDiagnostic,
  PdfSemanticDocument,
} from "./pdf-semantic-types";

/** 文档级语义归一；页面只作为几何和诊断来源，不单独归一。 */
export function normalize_pdf_document(raw: PdfRawDocument): PdfSemanticDocument {
  const diagnostics: PdfSemanticDiagnostic[] = [];
  if (
    raw.pages.some(
      (page, index) => index > 0 && page.page_number <= raw.pages[index - 1]!.page_number,
    )
  ) {
    diagnostics.push({ code: "page_order_non_monotonic", severity: "warning" });
  }
  const repeated = find_running_chrome(raw.pages);
  const candidates: Array<PdfSemanticBlock & { bbox?: PdfBbox }> = [];

  for (const page of [...raw.pages].sort((a, b) => a.page_number - b.page_number)) {
    const figures = page.blocks.filter((block) => block.kind === "figure" && block.bbox);
    for (const block of page.blocks) {
      const text = normalize_text(block.text ?? "");
      if (!text && ["heading", "paragraph", "list_item"].includes(block.kind)) {
        diagnostics.push({
          code: "empty_block",
          severity: "error",
          page_start: page.page_number,
          page_end: page.page_number,
        });
      }
      if (is_noise(block, text, page, repeated)) continue;
      if (block.kind === "figure" || block.kind === "rule") {
        candidates.push({
          order: 0,
          page_start: page.page_number,
          page_end: page.page_number,
          kind: block.kind,
          excluded: true,
          bbox: block.bbox,
        });
        continue;
      }
      if (
        figures.some(
          (figure) =>
            figure.bbox && block.bbox && contains(figure.bbox, block.bbox) && !is_caption(text),
        )
      ) {
        continue;
      }
      if (block.kind === "table" || block.kind === "grid_fallback") {
        const header = (block.header ?? []).map((cell) => normalize_text(cell.text));
        const rows =
          (block.rows ?? []).length > 0
            ? (block.rows ?? []).map((row) => row.map((cell) => normalize_text(cell.text)))
            : (block.lines ?? []).map((line) => line.split(/\t+|\s{2,}/u).map(normalize_text));
        const expected = header.length || rows[0]?.length || 0;
        if (
          block.kind === "grid_fallback" ||
          expected === 0 ||
          rows.some((row) => row.length !== expected)
        ) {
          diagnostics.push({
            code: "table_structure_uncertain",
            severity: "warning",
            page_start: page.page_number,
            page_end: page.page_number,
          });
        }
        candidates.push({
          order: 0,
          page_start: page.page_number,
          page_end: page.page_number,
          kind: "table",
          header,
          rows,
          bbox: block.bbox,
        });
        continue;
      }
      const kind: "heading" | "paragraph" | "list_item" | "caption" = is_caption(text)
        ? "caption"
        : block.kind === "heading" && should_demote_heading(text, page, block)
          ? "paragraph"
          : block.kind === "heading" || block.kind === "paragraph" || block.kind === "list_item"
            ? block.kind
            : "paragraph";
      candidates.push({
        order: 0,
        page_start: page.page_number,
        page_end: page.page_number,
        kind: kind === "caption" ? "caption" : kind,
        text,
        level: kind === "heading" ? clamp_level(block.level) : undefined,
        ordered: kind === "list_item" ? block.ordered : undefined,
        marker: kind === "list_item" ? block.marker : undefined,
        bbox: block.bbox,
      });
    }
  }

  const merged: Array<PdfSemanticBlock & { bbox?: PdfBbox }> = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous && can_join(previous, candidate)) {
      merged[merged.length - 1] = {
        ...previous,
        text: join_text(previous.text ?? "", candidate.text ?? ""),
        page_end: candidate.page_end,
        bbox: union_bbox(previous.bbox, candidate.bbox),
      };
    } else {
      merged.push(candidate);
    }
  }
  const blocks = merged.map(({ bbox: _bbox, ...block }, index) => ({ ...block, order: index }));
  validate_structure(blocks, diagnostics);
  return {
    blocks,
    diagnostics,
  };
}

/** 清理 PDF 文本层的控制字符、视觉换行和断词，不改写正常连字符。 */
function normalize_text(value: string): string {
  const cleaned = Array.from(value.replace(/\r\n?/gu, "\n"))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return !(code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31));
    })
    .join("");
  return cleaned
    .replace(/([\p{L}\p{N}])-\s+([\p{L}\p{N}])/gu, "$1$2")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .trim();
}

/** 用跨页重复且位于边缘的 block 识别运行页眉和页脚。 */
function find_running_chrome(pages: readonly PdfRawPage[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const block of page.blocks) {
      if (!block.text || !block.bbox || !at_edge(block.bbox, page.height)) continue;
      const text = normalize_text(block.text);
      if (text.length > 0) seen.add(text.toLowerCase());
    }
    for (const text of seen) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= 2).map(([text]) => text));
}

function is_noise(
  block: PdfRawBlock,
  text: string,
  page: PdfRawPage,
  repeated: ReadonlySet<string>,
): boolean {
  if (!text && block.kind !== "table" && block.kind !== "figure" && block.kind !== "rule")
    return true;
  if (!block.bbox || !at_edge(block.bbox, page.height)) return false;
  if (repeated.has(text.toLowerCase())) return true;
  return /^\d{1,4}$/u.test(text);
}

function at_edge(bbox: PdfBbox, page_height: number): boolean {
  return bbox.y <= page_height * 0.12 || bbox.y + bbox.height >= page_height * 0.88;
}

function should_demote_heading(text: string, page: PdfRawPage, block: PdfRawBlock): boolean {
  if (/^(abstract|index\s+terms?|keywords?)\s*:?$/iu.test(text)) return true;
  if (page.page_number === 1 && /^(?:by\s+.+|.+,.+|.+@.+)$/iu.test(text)) return true;
  if (
    page.page_number <= 2 &&
    !block.level &&
    /^[\p{L} .,'-]{2,80}$/u.test(text) &&
    text.split(/\s+/u).length <= 12
  )
    return true;
  return false;
}

function is_caption(text: string): boolean {
  return /^(figure|fig\.?|table)\s*[\d\w-]*\s*[:.-]/iu.test(text);
}

/** 判断相邻块是否属于同一标题或未完段落，避免跨结构误合并。 */
function can_join(
  left: PdfSemanticBlock & { bbox?: PdfBbox },
  right: PdfSemanticBlock & { bbox?: PdfBbox },
): boolean {
  if (left.kind === "heading" && right.kind === "heading") {
    if (left.page_start !== right.page_start || left.level !== right.level) return false;
    return (
      !left.bbox ||
      !right.bbox ||
      right.bbox.y - (left.bbox.y + left.bbox.height) <=
        Math.max(left.bbox.height, right.bbox.height) * 3
    );
  }
  if (left.kind !== "paragraph" || right.kind !== "paragraph") return false;
  if (left.page_end > right.page_start || right.page_start - left.page_end > 1) return false;
  const left_text = left.text ?? "";
  const right_text = right.text ?? "";
  if (/[.!?。！？:;]$/u.test(left_text)) return false;
  if (!/^[\p{Ll}\p{N}(]/u.test(right_text)) return false;
  if (left.bbox && right.bbox && !same_column(left.bbox, right.bbox)) {
    const cross_column =
      right.page_start === left.page_start &&
      right.bbox.x > left.bbox.x &&
      right.bbox.y <= left.bbox.y + left.bbox.height * 2;
    if (!cross_column) return false;
  }
  return true;
}

function same_column(left: PdfBbox, right: PdfBbox): boolean {
  const overlap = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  return overlap > 0 || Math.abs(left.x - right.x) < Math.max(left.width, right.width) * 0.5;
}

function join_separator(left: string, right: string): string {
  return /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right) ? " " : "";
}

function join_text(left: string, right: string): string {
  if (left.endsWith("-") && /^[\p{L}\p{N}]/u.test(right)) return `${left.slice(0, -1)}${right}`;
  return `${left}${join_separator(left, right)}${right}`;
}

function contains(outer: PdfBbox, inner: PdfBbox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function union_bbox(left?: PdfBbox, right?: PdfBbox): PdfBbox | undefined {
  if (!left) return right;
  if (!right) return left;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(left.x + left.width, right.x + right.width) - x,
    height: Math.max(left.y + left.height, right.y + right.height) - y,
  };
}

function clamp_level(level?: number): number {
  return Math.min(6, Math.max(1, Math.round(level ?? 2)));
}

/** 在写出 Markdown 前检查块顺序、文本完整性和表格矩形性。 */
function validate_structure(
  blocks: readonly PdfSemanticBlock[],
  diagnostics: PdfSemanticDiagnostic[],
): void {
  const orders = blocks.map((block) => block.order);
  if (new Set(orders).size !== orders.length)
    diagnostics.push({ code: "order_not_unique", severity: "error" });
  for (const block of blocks) {
    if (
      ["heading", "paragraph", "list_item", "caption"].includes(block.kind) &&
      !block.text?.trim()
    )
      diagnostics.push({
        code: "empty_block",
        severity: "error",
        page_start: block.page_start,
        page_end: block.page_end,
      });
    if (block.kind === "table" && block.rows?.some((row) => row.length !== block.rows?.[0]?.length))
      diagnostics.push({
        code: "table_structure_uncertain",
        severity: "warning",
        page_start: block.page_start,
        page_end: block.page_end,
      });
  }
}
