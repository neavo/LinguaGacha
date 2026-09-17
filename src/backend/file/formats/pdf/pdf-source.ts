import { Type, type Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { createHash } from "node:crypto";
import type { PDFDocument, PDFPage, PDFRegion } from "../../../../shared/pdf";
import { AGENT_WORKSPACE_FP_LENGTH } from "../../../../shared/project/agent-workspace";

const positive = Type.Number({ exclusiveMinimum: 0 });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const fp = Type.String({
  minLength: AGENT_WORKSPACE_FP_LENGTH,
  maxLength: AGENT_WORKSPACE_FP_LENGTH,
});
const PDF_REGION_SCHEMA = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    x: Type.Number({ minimum: 0 }),
    y: Type.Number({ minimum: 0 }),
    width: positive,
    height: positive,
  },
  { additionalProperties: false },
);
const PDF_PAGE_UPDATE_SCHEMA = Type.Object(
  {
    translation: Type.Union([
      Type.Null(),
      Type.Object(
        {
          kind: Type.Literal("translate"),
          markdown: Type.String(),
          background: Type.Optional(PDF_REGION_SCHEMA),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("keep"), reason: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("omit"), reason: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ]),
    reviewed: Type.Boolean(),
    notes: Type.String(),
  },
  { additionalProperties: false },
);
const PDF_PAGE_SCHEMA = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    width: positive,
    height: positive,
    rotation: Type.Number(),
    label: Type.Union([Type.String(), Type.Null()]),
    ...PDF_PAGE_UPDATE_SCHEMA.properties,
  },
  { additionalProperties: false },
);
const PDF_DOCUMENT_SCHEMA = Type.Object(
  {
    digest,
    pages: Type.Array(PDF_PAGE_SCHEMA, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export const PDF_WORKSPACE_SCHEMA = Type.Object(
  {
    file_path: Type.String({ minLength: 1 }),
    fp,
    digest,
    ...PDF_PAGE_SCHEMA.properties,
  },
  { additionalProperties: false },
);
export const PDF_UPDATE_SCHEMA = Type.Object(
  {
    file_path: Type.String({ minLength: 1 }),
    page: Type.Integer({ minimum: 1 }),
    fp,
    ...PDF_PAGE_UPDATE_SCHEMA.properties,
  },
  { additionalProperties: false },
);
export type PDFUpdateIntent = Static<typeof PDF_UPDATE_SCHEMA> & { line: number };

/** 持久化边界校验完整形状与页序，数组索引才能用于页面定位。 */
export function read_pdf_document(value: unknown): PDFDocument {
  if (!Check(PDF_DOCUMENT_SCHEMA, value)) throw new Error("Invalid PDF document.");
  if (value.pages.some((page, i) => page.page !== i + 1))
    throw new Error("PDF pages must follow source order.");
  return value;
}

/** 页指纹绑定路径与原稿摘要；邻页修改不影响本页，来源替换会使旧快照失效。 */
export function pdf_page_fingerprint(file_path: string, digest: string, page: PDFPage): string {
  const translation = page.translation;
  const facts = [
    // 固定字段顺序消除 JSON 键序差异，页指纹与其它工作区对象使用同一摘要长度。
    file_path,
    digest,
    page.page,
    page.width,
    page.height,
    page.rotation,
    page.label,
    translation === null
      ? null
      : translation.kind !== "translate"
        ? [translation.kind, translation.reason]
        : [
            "translate",
            translation.markdown,
            translation.background
              ? [
                  translation.background.page,
                  translation.background.x,
                  translation.background.y,
                  translation.background.width,
                  translation.background.height,
                ]
              : null,
          ],
    page.reviewed,
    page.notes,
  ];
  return createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("base64url")
    .slice(0, AGENT_WORKSPACE_FP_LENGTH);
}

/** 图片引用按原稿页尺寸收窄，阻止越界或无效坐标进入渲染。 */
export function validate_pdf_region(source: PDFDocument, region: PDFRegion): void {
  const page = source.pages[region.page - 1];
  if (
    !Check(PDF_REGION_SCHEMA, region) ||
    !page ||
    region.x + region.width > page.width ||
    region.y + region.height > page.height
  )
    throw new Error("PDF region is outside its page.");
}
