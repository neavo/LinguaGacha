import { Type, type Static } from "typebox";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }); // 跨包与页面引用的稳定标识。
const SHA256 = Type.String({ pattern: "^[a-f0-9]{64}$" }); // 小写十六进制 SHA-256 摘要。
export const IMAGE_DIRECTION_SCHEMA = Type.Union([
  Type.Literal("horizontal-tb"),
  Type.Literal("vertical-rl"),
]); // 文本块书写方向。
export const IMAGE_PRESERVE_REASON_SCHEMA = Type.Union([
  Type.Literal("intentional"),
  Type.Literal("unreadable"),
  Type.Literal("repair_failed"),
]); // 保留原因：有意不译、无法识读或修复失败。
export const IMAGE_SELECTION_SCHEMA = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    sha256: SHA256,
  },
  { additionalProperties: false },
);
const COLOR_CHANNEL = Type.Integer({ minimum: 0, maximum: 255 });
export const IMAGE_FILL_SCHEMA = Type.Object(
  {
    color: Type.Tuple([COLOR_CHANNEL, COLOR_CHANNEL, COLOR_CHANNEL]),
  },
  { additionalProperties: false },
);

const REGION_SCHEMA = Type.Object(
  {
    regionId: ID,
    disposition: Type.Union([Type.Literal("translate"), Type.Literal("preserve")]),
    preserveReason: Type.Optional(IMAGE_PRESERVE_REASON_SCHEMA),
    selection: Type.Union([IMAGE_SELECTION_SCHEMA, Type.Null()]),
    direction: Type.Union([IMAGE_DIRECTION_SCHEMA, Type.Null()]),
    fill: Type.Union([IMAGE_FILL_SCHEMA, Type.Null()]),
  },
  { additionalProperties: false },
); // 单页内确认的语义文本区域。

/** 图片书完整结构契约，用于草稿保存与 `.image` 归档校验。 */
export const IMAGE_BOOK_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    bookId: ID,
    pages: Type.Array(
      Type.Object(
        {
          pageId: ID,
          original: Type.String({ minLength: 1 }),
          sha256: SHA256,
          width: Type.Integer({ minimum: 1, maximum: 100000 }),
          height: Type.Integer({ minimum: 1, maximum: 100000 }),
          orientation: Type.Integer({ minimum: 1, maximum: 8 }),
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
    disposition: Type.Union([Type.Literal("translate"), Type.Literal("preserve")]),
    preserveReason: Type.Optional(IMAGE_PRESERVE_REASON_SCHEMA),
    mask: Type.Optional(Type.String({ minLength: 1 })),
    maskSha256: Type.Optional(SHA256),
  },
  { additionalProperties: false },
); // 已验收归档中的单区域消字或保留记录。

/** 第一阶段已验收底图与实际掩码清单契约（`clean.json`）。 */
export const IMAGE_CLEAN_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    bookId: ID,
    status: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
    pages: Type.Array(
      Type.Object(
        {
          pageId: ID,
          clean: Type.String({ minLength: 1 }),
          cleanSha256: SHA256,
          inputSha256: SHA256,
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
export type ImagePreserveReason = Static<typeof IMAGE_PRESERVE_REASON_SCHEMA>;
export type ImageBook = Static<typeof IMAGE_BOOK_SCHEMA>;
export type ImagePage = ImageBook["pages"][number];
export type ImageRegion = ImagePage["regions"][number];
export type ImageClean = Static<typeof IMAGE_CLEAN_SCHEMA>;
export type ImageCleanPage = ImageClean["pages"][number];
export type ImageCleanRegion = ImageCleanPage["regions"][number];
export type ImageRecord = { message: string; name?: string; pageId: string; regionId: string }; // 与区域对应的原文条目。

export type ImageSelection = Static<typeof IMAGE_SELECTION_SCHEMA>;
