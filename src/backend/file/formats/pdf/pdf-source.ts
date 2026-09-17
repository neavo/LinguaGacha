import { Type } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import type { PDFDocument, PDFRegion } from "../../../../shared/pdf";

const positive = Type.Number({ exclusiveMinimum: 0 });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
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
export const PDF_PAGE_UPDATE_SCHEMA = Type.Object(
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
export const PDF_PAGE_SCHEMA = Type.Object(
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
export const PDF_DOCUMENT_SCHEMA = Type.Object(
  {
    digest,
    pages: Type.Array(PDF_PAGE_SCHEMA, { minItems: 1 }),
  },
  { additionalProperties: false },
);
/** 持久化边界校验完整形状与页序，数组索引才能用于页面定位。 */
export function read_pdf_document(value: unknown): PDFDocument {
  if (!Check(PDF_DOCUMENT_SCHEMA, value)) throw new Error("Invalid PDF document.");
  if (value.pages.some((page, i) => page.page !== i + 1))
    throw new Error("PDF pages must follow source order.");
  return value;
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
