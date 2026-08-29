/** PDF 抽取阶段与语义投影之间唯一共享的数据契约。 */
export type PdfBbox = Readonly<{ x: number; y: number; width: number; height: number }>;

/** 表格单元格的文本值。 */
export type PdfRawCell = Readonly<{ text: string }>;

export type PdfRawBlock = Readonly<{
  kind: "heading" | "paragraph" | "list_item" | "table" | "figure" | "rule" | "grid_fallback";
  text?: string;
  level?: number;
  ordered?: boolean;
  marker?: string;
  header?: readonly PdfRawCell[];
  rows?: readonly (readonly PdfRawCell[])[];
  lines?: readonly string[];
  bbox?: PdfBbox;
}>;

export type PdfRawPage = Readonly<{
  page_number: number;
  width: number;
  height: number;
  blocks: readonly PdfRawBlock[];
}>;

export type PdfRawDocument = Readonly<{
  pages: readonly PdfRawPage[];
}>;

export type PdfSemanticDiagnosticCode =
  | "page_order_non_monotonic"
  | "empty_block"
  | "table_structure_uncertain"
  | "order_not_unique";

/** 读取期间可观察但不写入项目事实的结构诊断。 */
export type PdfSemanticDiagnostic = Readonly<{
  code: PdfSemanticDiagnosticCode;
  severity: "warning" | "error";
  page_start?: number;
  page_end?: number;
  detail?: string;
}>;

/** 归一后的可翻译块；figure/rule 仅保留来源位置并标记为排除。 */
export type PdfSemanticBlock = Readonly<{
  order: number;
  page_start: number;
  page_end: number;
  kind: "heading" | "paragraph" | "list_item" | "table" | "caption" | "figure" | "rule";
  text?: string;
  level?: number;
  ordered?: boolean;
  marker?: string;
  header?: readonly string[];
  rows?: readonly (readonly string[])[];
  excluded?: boolean;
}>;

/** 文档级归一结果，供 PDF reader 和 Markdown writer 消费。 */
export type PdfSemanticDocument = Readonly<{
  blocks: readonly PdfSemanticBlock[];
  diagnostics: readonly PdfSemanticDiagnostic[];
}>;
