import { Type, type Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { createHash } from "node:crypto";
import type { PDFDocument, PDFTranslation, PDFRegion } from "../../../../shared/pdf";
import { AGENT_WORKSPACE_FP_LENGTH } from "../../../../shared/project/agent-workspace";

const positive = Type.Number({ exclusiveMinimum: 0 });
export const PDF_REGION_SCHEMA = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    x: Type.Number({ minimum: 0 }),
    y: Type.Number({ minimum: 0 }),
    width: positive,
    height: positive,
  },
  { additionalProperties: false },
);
export const PDF_TRANSLATION_SCHEMA = Type.Object(
  {
    sections: Type.Array(
      Type.Union([
        Type.Object(
          {
            kind: Type.Literal("translate"),
            page_start: Type.Integer({ minimum: 1 }),
            page_end: Type.Integer({ minimum: 1 }),
            markdown: Type.String({ minLength: 1 }),
            background: Type.Optional(PDF_REGION_SCHEMA),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("omit"),
            page_start: Type.Integer({ minimum: 1 }),
            page_end: Type.Integer({ minimum: 1 }),
            reason: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    reviewed_pages: Type.Array(Type.Integer({ minimum: 1 }), { uniqueItems: true }),
    notes: Type.String(),
  },
  { additionalProperties: false },
);
export const PDF_DOCUMENT_SCHEMA = Type.Object(
  {
    source: Type.Object(
      {
        digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        pages: Type.Array(
          Type.Object(
            {
              number: Type.Integer({ minimum: 1 }),
              width: positive,
              height: positive,
              rotation: Type.Number(),
              label: Type.Union([Type.String(), Type.Null()]),
            },
            { additionalProperties: false },
          ),
          { minItems: 1 },
        ),
      },
      { additionalProperties: false },
    ),
    translation: Type.Union([PDF_TRANSLATION_SCHEMA, Type.Null()]),
  },
  { additionalProperties: false },
);
export const PDF_WORKSPACE_SCHEMA = Type.Object(
  {
    file_path: Type.String(),
    fp: Type.String(),
    ...PDF_DOCUMENT_SCHEMA.properties,
  },
  { additionalProperties: false },
);
export const PDF_UPDATE_SCHEMA = Type.Object(
  {
    file_path: Type.String({ minLength: 1 }),
    fp: Type.String({ minLength: AGENT_WORKSPACE_FP_LENGTH, maxLength: AGENT_WORKSPACE_FP_LENGTH }),
    translation_path: Type.String({
      minLength: 1,
      description: "work 下完整 PDFTranslation JSON 文件的相对路径",
    }),
  },
  { additionalProperties: false },
);
export type PDFUpdateIntent = Static<typeof PDF_UPDATE_SCHEMA> & {
  line: number;
  translation: PDFTranslation;
};

/** 持久化边界校验完整形状与页序，数组索引才能用于页面定位。 */
export function read_pdf_document(value: unknown): PDFDocument {
  if (!Check(PDF_DOCUMENT_SCHEMA, value)) throw new Error("Invalid PDF document.");
  if (value.source.pages.some((page, i) => page.number !== i + 1))
    throw new Error("PDF pages must follow source order.");
  return value;
}

/** 指纹覆盖来源、译稿和续做记录，阻止旧快照覆盖任何已保存事实。 */
export function pdf_document_fingerprint(document: PDFDocument): string {
  return createHash("sha256")
    .update(JSON.stringify(document))
    .digest("base64url")
    .slice(0, AGENT_WORKSPACE_FP_LENGTH);
}

/** 图片引用按原稿页尺寸收窄，阻止越界或无效坐标进入渲染。 */
export function validate_pdf_region(source: PDFDocument["source"], region: PDFRegion): void {
  const page = source.pages[region.page - 1];
  if (
    !Check(PDF_REGION_SCHEMA, region) ||
    !page ||
    region.x + region.width > page.width ||
    region.y + region.height > page.height
  )
    throw new Error("PDF region is outside its page.");
}
