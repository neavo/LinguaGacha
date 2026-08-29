import type { PdfSemanticBlock, PdfSemanticDocument } from "./pdf-semantic-types";

/** 语义文档到 Markdown 的确定性纯投影。 */
export function write_pdf_semantic_markdown(document: PdfSemanticDocument): string {
  return document.blocks
    .filter((block) => !block.excluded && block.kind !== "figure" && block.kind !== "rule")
    .sort((a, b) => a.order - b.order)
    .map(write_block)
    .filter(Boolean)
    .join("\n\n")
    .concat(
      document.blocks.some(
        (block) => !block.excluded && block.kind !== "figure" && block.kind !== "rule",
      )
        ? "\n"
        : "",
    );
}

/** 将单个语义块投影为 Markdown，不承担排序或语义判断。 */
function write_block(block: PdfSemanticBlock): string {
  switch (block.kind) {
    case "heading":
      return `${"#".repeat(block.level ?? 2)} ${block.text ?? ""}`;
    case "list_item": {
      const marker = block.ordered
        ? `${block.marker?.replace(/\D/gu, "") || "1"}.`
        : block.marker || "-";
      return `${"  ".repeat(Math.max(0, (block.level ?? 1) - 1))}${marker} ${block.text ?? ""}`;
    }
    case "table": {
      const header = block.header ?? [];
      const rows = block.rows ?? [];
      if (header.length === 0 && rows.length === 0) return "";
      const width = Math.max(header.length, ...rows.map((row) => row.length));
      const pad = (row: readonly string[]) =>
        `| ${[...row, ...Array(Math.max(0, width - row.length)).fill("")].map(escape_cell).join(" | ")} |`;
      return [pad(header), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.map(pad)].join(
        "\n",
      );
    }
    case "paragraph":
    case "caption":
      return block.text ?? "";
    default:
      return "";
  }
}

/** 保持 GFM 表格单元格边界，换行转为空格避免破坏表格。 */
function escape_cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
}
