import { Type, type Static } from "typebox";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }); // 跨包与页面引用的稳定标识。
const SHA256 = Type.String({ pattern: "^[a-f0-9]{64}$" }); // 小写十六进制 SHA-256 摘要。
export const IMAGE_DIRECTION_SCHEMA = Type.Union([
  Type.Literal("horizontal-tb"),
  Type.Literal("vertical-rl"),
]); // 文本块书写方向。
const IMAGE_LAYOUT_AREA_SCHEMA = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const IMAGE_QUAD_SCHEMA = Type.Tuple([
  Type.Tuple([Type.Integer(), Type.Integer()]),
  Type.Tuple([Type.Integer(), Type.Integer()]),
  Type.Tuple([Type.Integer(), Type.Integer()]),
  Type.Tuple([Type.Integer(), Type.Integer()]),
]);
const IMAGE_TEXT_BOX_SCHEMA = Type.Object(
  {
    textBoxId: ID,
    box: IMAGE_QUAD_SCHEMA,
    coreBox: IMAGE_QUAD_SCHEMA,
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const COLOR_CHANNEL = Type.Integer({ minimum: 0, maximum: 255 });
const IMAGE_COLOR_SCHEMA = Type.Tuple([COLOR_CHANNEL, COLOR_CHANNEL, COLOR_CHANNEL]);
export const IMAGE_FILL_SCHEMA = Type.Object(
  {
    color: IMAGE_COLOR_SCHEMA,
  },
  { additionalProperties: false },
);

const REGION_SCHEMA = Type.Object(
  {
    regionId: ID,
    kind: Type.Union([Type.Literal("bubble"), Type.Literal("unframed")]),
    textBoxIds: Type.Array(ID, { minItems: 1, maxItems: 10000 }),
    layoutArea: IMAGE_LAYOUT_AREA_SCHEMA,
    direction: IMAGE_DIRECTION_SCHEMA,
    backgroundColor: IMAGE_COLOR_SCHEMA,
  },
  { additionalProperties: false },
); // 单页内确认的语义文本区域。

/** 图片书完整结构契约，用于 `.image` 归档校验。 */
export const IMAGE_BOOK_SCHEMA = Type.Object(
  {
    bookId: ID,
    pages: Type.Array(
      Type.Object(
        {
          pageId: ID,
          relativePath: Type.String({ minLength: 1 }),
          original: Type.String({ minLength: 1 }),
          sha256: SHA256,
          width: Type.Integer({ minimum: 1, maximum: 100000 }),
          height: Type.Integer({ minimum: 1, maximum: 100000 }),
          orientation: Type.Integer({ minimum: 1, maximum: 8 }),
          textBoxes: Type.Array(IMAGE_TEXT_BOX_SCHEMA, { maxItems: 10000 }),
          regions: Type.Array(REGION_SCHEMA, { maxItems: 10000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);

const CLEAN_REGION_SCHEMA = Type.Object(
  {
    regionId: ID,
    status: Type.Union([Type.Literal("cleaned"), Type.Literal("failed")]),
    eraseMask: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
); // 单区域自动消字结果；失败区域在输出时恢复原图。

/** 自动底图与实际掩码清单契约（`clean.json`）。 */
export const IMAGE_CLEAN_SCHEMA = Type.Object(
  {
    bookId: ID,
    pages: Type.Array(
      Type.Object(
        {
          pageId: ID,
          clean: Type.String({ minLength: 1 }),
          regions: Type.Array(CLEAN_REGION_SCHEMA, { maxItems: 10000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);

export type ImageDirection = Static<typeof IMAGE_DIRECTION_SCHEMA>;
export type ImageBook = Static<typeof IMAGE_BOOK_SCHEMA>;
export type ImagePage = ImageBook["pages"][number];
export type ImageRegion = ImagePage["regions"][number];
export type ImageClean = Static<typeof IMAGE_CLEAN_SCHEMA>;
export type ImageCleanPage = ImageClean["pages"][number];
export type ImageCleanRegion = ImageCleanPage["regions"][number];
export const IMAGE_RECORD_SCHEMA = Type.Object(
  { message: Type.String(), pageId: ID, regionId: ID },
  { additionalProperties: false },
);
export type ImageRecord = Static<typeof IMAGE_RECORD_SCHEMA>; // 与区域对应的原文条目。

const IMAGE_OUTPUT_REASON_CODE_SCHEMA = Type.Union([
  Type.Literal("tight_margin"),
  Type.Literal("off_center"),
  Type.Literal("small_font"),
  Type.Literal("layout_no_fit"),
  Type.Literal("outside_layout_area"),
  Type.Literal("erase_failed"),
  Type.Literal("translation_incomplete"),
]);

const IMAGE_OUTPUT_REASON_SCHEMA = Type.Object(
  {
    code: IMAGE_OUTPUT_REASON_CODE_SCHEMA,
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const IMAGE_OUTPUT_ENTRY_SCHEMA = Type.Object(
  {
    region_id: Type.Optional(ID),
    status: Type.Union([Type.Literal("success"), Type.Literal("warning"), Type.Literal("failure")]),
    output: Type.Union([Type.Literal("original"), Type.Literal("translated")]),
    reasons: Type.Array(IMAGE_OUTPUT_REASON_SCHEMA),
  },
  { additionalProperties: false },
);
export const IMAGE_OUTPUT_ASSET_SCHEMA = Type.Object(
  {
    asset_path: Type.String({ minLength: 1 }),
    files: Type.Array(
      Type.Object(
        { path: Type.String({ minLength: 1 }), entries: Type.Array(IMAGE_OUTPUT_ENTRY_SCHEMA) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ImageOutputAsset = Static<typeof IMAGE_OUTPUT_ASSET_SCHEMA>;

export const IMAGE_OUTPUT_SUMMARY_SCHEMA = Type.Object(
  {
    success: Type.Integer({ minimum: 0 }),
    warnings: Type.Integer({ minimum: 0 }),
    failures: Type.Integer({ minimum: 0 }),
    originals: Type.Integer({ minimum: 0 }),
    translated: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ImageOutputSummary = Static<typeof IMAGE_OUTPUT_SUMMARY_SCHEMA>;

export const IMAGE_OUTPUT_REPORT_SCHEMA = Type.Object(
  { path: Type.String({ minLength: 1 }), summary: IMAGE_OUTPUT_SUMMARY_SCHEMA },
  { additionalProperties: false },
);
export type ImageOutputReport = Static<typeof IMAGE_OUTPUT_REPORT_SCHEMA>;
export type ImageQualityResult = { output_path: string; report: ImageOutputReport };

export const IMAGE_CREATE_RESULT_SCHEMA = Type.Object(
  {
    output_path: Type.String({ minLength: 1 }),
    diagnostics_path: Type.String({ minLength: 1 }),
    pages: Type.Array(
      Type.Object(
        {
          page_id: ID,
          preview_path: Type.String({ minLength: 1 }),
          detected: Type.Integer({ minimum: 0 }),
          regions: Type.Integer({ minimum: 0 }),
          failures: Type.Array(
            Type.Object(
              { region_id: ID, message: Type.String({ minLength: 1 }) },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ImageCreateResult = Static<typeof IMAGE_CREATE_RESULT_SCHEMA>;
